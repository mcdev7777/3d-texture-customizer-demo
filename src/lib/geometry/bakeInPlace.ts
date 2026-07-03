import {
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { SurfacePatternSettings } from '../../types/pattern'
import type { SelectedSurface } from '../../types/surfaceSelection'
import {
  BASE_TILE_WORLD,
  depthLevelToWorld,
  getReliefDisplacement,
  sampleReliefHeight,
} from '../textures/patternPlacementMath'
import { getPatternImageData } from '../../utils/patternTextures'
import { hasProceduralEvaluator } from '../textures/patternEvaluators'
import { buildTextureTargets, type TextureTarget } from './textureTargets'
import type { SurfaceProjection } from './surfaceProjection'

export interface BakeQuality {
  samplesPerTile: number
  maxLevel: number
  budgetPerTarget: number
}

export const PREVIEW_QUALITY: BakeQuality = {
  samplesPerTile: 5,
  maxLevel: 5,
  budgetPerTarget: 30_000,
}
export const COMMITTED_QUALITY: BakeQuality = {
  samplesPerTile: 7,
  maxLevel: 6,
  budgetPerTarget: 80_000,
}

// ---------------------------------------------------------------------------
// Geometry lifecycle tracker
// ---------------------------------------------------------------------------

const pristineGeometries = new Map<string, BufferGeometry>()
const prePreviewGeometries = new Map<string, BufferGeometry>()

export function storePristine(mesh: Mesh): void {
  if (!pristineGeometries.has(mesh.uuid)) {
    pristineGeometries.set(mesh.uuid, mesh.geometry.clone())
  }
}

export function applyPreviewGeometry(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  if (!prePreviewGeometries.has(mesh.uuid)) {
    prePreviewGeometries.set(mesh.uuid, mesh.geometry)
  }

  const baseGeo = prePreviewGeometries.get(mesh.uuid)!
  const displaced = bakeDisplacement(mesh, baseGeo, selectedSurface, settings, PREVIEW_QUALITY)

  if (mesh.geometry !== baseGeo) mesh.geometry.dispose()
  mesh.geometry = displaced
}

export function removePreviewGeometry(mesh: Mesh): void {
  const baseGeo = prePreviewGeometries.get(mesh.uuid)
  if (!baseGeo) return
  if (mesh.geometry !== baseGeo) mesh.geometry.dispose()
  mesh.geometry = baseGeo
  prePreviewGeometries.delete(mesh.uuid)
}

export function commitGeometry(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  const baseGeo = prePreviewGeometries.get(mesh.uuid) ?? mesh.geometry

  if (!pristineGeometries.has(mesh.uuid)) {
    pristineGeometries.set(mesh.uuid, baseGeo.clone())
  }

  const displaced = bakeDisplacement(mesh, baseGeo, selectedSurface, settings, COMMITTED_QUALITY)

  const currentGeo = mesh.geometry
  const pristine = pristineGeometries.get(mesh.uuid)

  prePreviewGeometries.delete(mesh.uuid)

  if (currentGeo !== baseGeo && currentGeo !== pristine) {
    currentGeo.dispose()
  }

  mesh.geometry = displaced
}

export function resetAllGeometries(modelRoot: Object3D | null): void {
  if (modelRoot) {
    modelRoot.traverse((child) => {
      if (!('isMesh' in child) || !child.isMesh) return
      const mesh = child as Mesh
      const pristine = pristineGeometries.get(mesh.uuid)
      if (pristine) {
        if (mesh.geometry !== pristine) mesh.geometry.dispose()
        mesh.geometry = pristine
      }
    })
  }
  pristineGeometries.clear()
  prePreviewGeometries.clear()
}

export function hasActivePreview(meshUuid: string): boolean {
  return prePreviewGeometries.has(meshUuid)
}

// ---------------------------------------------------------------------------
// Subdivision + displacement (adapted from reliefPatch.ts, no BASE_OFFSET)
// ---------------------------------------------------------------------------

interface DisplaceContext {
  origin: Vector3
  tangent: Vector3
  bitangent: Vector3
  dir: Vector3
  settings: SurfacePatternSettings
  depthWorld: number
  imageData: ImageData | null
}

const _p = new Vector3()

function displaceVertex(
  x: number,
  y: number,
  z: number,
  ctx: DisplaceContext,
  out: number[],
): void {
  _p.set(x - ctx.origin.x, y - ctx.origin.y, z - ctx.origin.z)
  const uWorld = _p.dot(ctx.tangent)
  const vWorld = _p.dot(ctx.bitangent)
  const mask = sampleReliefHeight(
    ctx.settings.patternId as string,
    uWorld,
    vWorld,
    ctx.settings,
    ctx.imageData,
  )
  const disp = getReliefDisplacement(mask, ctx.settings.mode, ctx.depthWorld)
  out.push(x + ctx.dir.x * disp, y + ctx.dir.y * disp, z + ctx.dir.z * disp)
}

function subdivide(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  level: number,
  ctx: DisplaceContext,
  out: number[],
): void {
  if (level <= 0) {
    displaceVertex(ax, ay, az, ctx, out)
    displaceVertex(bx, by, bz, ctx, out)
    displaceVertex(cx, cy, cz, ctx, out)
    return
  }
  const abx = (ax + bx) / 2, aby = (ay + by) / 2, abz = (az + bz) / 2
  const bcx = (bx + cx) / 2, bcy = (by + cy) / 2, bcz = (bz + cz) / 2
  const cax = (cx + ax) / 2, cay = (cy + ay) / 2, caz = (cz + az) / 2
  const n = level - 1
  subdivide(ax, ay, az, abx, aby, abz, cax, cay, caz, n, ctx, out)
  subdivide(abx, aby, abz, bx, by, bz, bcx, bcy, bcz, n, ctx, out)
  subdivide(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz, n, ctx, out)
  subdivide(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz, n, ctx, out)
}

function edgeLength(t: number[], i: number, j: number): number {
  const dx = t[i] - t[j]
  const dy = t[i + 1] - t[j + 1]
  const dz = t[i + 2] - t[j + 2]
  return Math.hypot(dx, dy, dz)
}

function computeSubdivisionLevels(
  triangles: number[],
  spacing: number,
  quality: BakeQuality,
): number[] {
  const triCount = triangles.length / 9
  const levels = new Array<number>(triCount)
  let total = 0
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const maxEdge = Math.max(
      edgeLength(triangles, o, o + 3),
      edgeLength(triangles, o + 3, o + 6),
      edgeLength(triangles, o + 6, o),
    )
    const ratio = maxEdge / Math.max(spacing, 1e-6)
    const level = Math.min(
      quality.maxLevel,
      Math.max(0, Math.ceil(Math.log2(Math.max(1, ratio)))),
    )
    levels[t] = level
    total += 4 ** level
  }

  while (total > quality.budgetPerTarget) {
    let changed = false
    total = 0
    for (let t = 0; t < triCount; t++) {
      if (levels[t] > 0) {
        levels[t] -= 1
        changed = true
      }
      total += 4 ** levels[t]
    }
    if (!changed) break
  }
  return levels
}

function subdivideTarget(
  target: TextureTarget,
  settings: SurfacePatternSettings,
  imageData: ImageData | null,
  quality: BakeQuality,
  out: number[],
): void {
  const projection: SurfaceProjection = target.projection
  const tileWorld = BASE_TILE_WORLD / Math.max(0.05, settings.scale)
  const spacing = tileWorld / quality.samplesPerTile

  const levels = computeSubdivisionLevels(target.triangles, spacing, quality)

  const ctx: DisplaceContext = {
    origin: projection.originWorld,
    tangent: projection.tangentWorld,
    bitangent: projection.bitangentWorld,
    dir: projection.normalWorld,
    settings,
    depthWorld: depthLevelToWorld(settings.depth),
    imageData,
  }

  const triCount = target.triangles.length / 9
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const tri = target.triangles
    subdivide(
      tri[o], tri[o + 1], tri[o + 2],
      tri[o + 3], tri[o + 4], tri[o + 5],
      tri[o + 6], tri[o + 7], tri[o + 8],
      levels[t],
      ctx,
      out,
    )
  }
}

// ---------------------------------------------------------------------------
// Core bake function
// ---------------------------------------------------------------------------

const _v = new Vector3()

/**
 * Bake displacement into a mesh geometry in-place. Takes a base geometry
 * (the geometry before this bake), extracts the selected faces, subdivides
 * and displaces them in world space, transforms back to local space, and
 * merges with non-selected faces into a new BufferGeometry.
 */
export function bakeDisplacement(
  mesh: Mesh,
  baseGeometry: BufferGeometry,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
  quality: BakeQuality,
): BufferGeometry {
  mesh.updateWorldMatrix(true, false)
  const worldMatrix = mesh.matrixWorld
  const inverseWorld = new Matrix4().copy(worldMatrix).invert()

  const isIndexed = !!baseGeometry.index
  const nonIndexed = isIndexed ? baseGeometry.toNonIndexed() : baseGeometry
  const pos = nonIndexed.getAttribute('position')
  const totalTriangles = Math.floor(pos.count / 3)

  const selectedSet = new Set(selectedSurface.triangleIndices)

  const worldSelectedPositions: number[] = []
  const localNonSelectedPositions: number[] = []

  for (let t = 0; t < totalTriangles; t++) {
    const base = t * 3
    if (selectedSet.has(t)) {
      for (let k = 0; k < 3; k++) {
        _v.set(pos.getX(base + k), pos.getY(base + k), pos.getZ(base + k))
        _v.applyMatrix4(worldMatrix)
        worldSelectedPositions.push(_v.x, _v.y, _v.z)
      }
    } else {
      for (let k = 0; k < 3; k++) {
        localNonSelectedPositions.push(
          pos.getX(base + k),
          pos.getY(base + k),
          pos.getZ(base + k),
        )
      }
    }
  }

  if (isIndexed) nonIndexed.dispose()

  const worldSelectedGeo = new BufferGeometry()
  worldSelectedGeo.setAttribute(
    'position',
    new Float32BufferAttribute(worldSelectedPositions, 3),
  )
  worldSelectedGeo.computeVertexNormals()

  const targets = buildTextureTargets(
    worldSelectedGeo,
    selectedSurface.normal,
    selectedSurface.point,
    selectedSurface.selectionType,
  )
  worldSelectedGeo.dispose()

  const patternId = settings.patternId as string
  const imageData = hasProceduralEvaluator(patternId) ? null : getPatternImageData(patternId)

  const worldDisplacedPositions: number[] = []
  for (const target of targets) {
    subdivideTarget(target, settings, imageData, quality, worldDisplacedPositions)
  }

  const localDisplacedPositions: number[] = []
  for (let i = 0; i < worldDisplacedPositions.length; i += 3) {
    _v.set(
      worldDisplacedPositions[i],
      worldDisplacedPositions[i + 1],
      worldDisplacedPositions[i + 2],
    )
    _v.applyMatrix4(inverseWorld)
    localDisplacedPositions.push(_v.x, _v.y, _v.z)
  }

  const totalFloats = localNonSelectedPositions.length + localDisplacedPositions.length
  const finalPositions = new Float32Array(totalFloats)
  for (let i = 0; i < localNonSelectedPositions.length; i++) {
    finalPositions[i] = localNonSelectedPositions[i]
  }
  for (let i = 0; i < localDisplacedPositions.length; i++) {
    finalPositions[localNonSelectedPositions.length + i] = localDisplacedPositions[i]
  }

  const raw = new BufferGeometry()
  raw.setAttribute('position', new Float32BufferAttribute(finalPositions, 3))

  const merged = mergeVertices(raw, 1e-4)
  raw.dispose()
  merged.computeVertexNormals()

  return merged
}
