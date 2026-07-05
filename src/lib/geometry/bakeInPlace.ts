import {
  BufferGeometry,
  DoubleSide,
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
import { buildTextureTargets } from './textureTargets'

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
const originalMaterialSides = new Map<string, number>()

export function storePristine(mesh: Mesh): void {
  if (!pristineGeometries.has(mesh.uuid)) {
    pristineGeometries.set(mesh.uuid, mesh.geometry.clone())
  }
}

function enableDoubleSide(mesh: Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const mat of materials) {
    if (!originalMaterialSides.has(mat.uuid)) {
      originalMaterialSides.set(mat.uuid, mat.side)
    }
    mat.side = DoubleSide
    mat.needsUpdate = true
  }
}

function restoreOriginalSide(mesh: Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const mat of materials) {
    const original = originalMaterialSides.get(mat.uuid)
    if (original !== undefined) {
      mat.side = original
      mat.needsUpdate = true
      originalMaterialSides.delete(mat.uuid)
    }
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
  enableDoubleSide(mesh)
}

export function removePreviewGeometry(mesh: Mesh): void {
  const baseGeo = prePreviewGeometries.get(mesh.uuid)
  if (!baseGeo) return
  if (mesh.geometry !== baseGeo) mesh.geometry.dispose()
  mesh.geometry = baseGeo
  prePreviewGeometries.delete(mesh.uuid)
  restoreOriginalSide(mesh)
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
  enableDoubleSide(mesh)
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
      restoreOriginalSide(mesh)
    })
  }
  pristineGeometries.clear()
  prePreviewGeometries.clear()
  originalMaterialSides.clear()
}

export function hasActivePreview(meshUuid: string): boolean {
  return prePreviewGeometries.has(meshUuid)
}

// ---------------------------------------------------------------------------
// Subdivision (tessellation only, no displacement)
// ---------------------------------------------------------------------------

/**
 * Recursively 4-split a triangle to the requested level, outputting
 * un-displaced vertex positions. Displacement happens in a second pass
 * so that smooth per-vertex normals can be computed across island boundaries.
 */
function subdivideFlat(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  level: number,
  out: number[],
): void {
  if (level <= 0) {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    return
  }
  const abx = (ax + bx) / 2, aby = (ay + by) / 2, abz = (az + bz) / 2
  const bcx = (bx + cx) / 2, bcy = (by + cy) / 2, bcz = (bz + cz) / 2
  const cax = (cx + ax) / 2, cay = (cy + ay) / 2, caz = (cz + az) / 2
  const n = level - 1
  subdivideFlat(ax, ay, az, abx, aby, abz, cax, cay, caz, n, out)
  subdivideFlat(abx, aby, abz, bx, by, bz, bcx, bcy, bcz, n, out)
  subdivideFlat(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz, n, out)
  subdivideFlat(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz, n, out)
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

// ---------------------------------------------------------------------------
// Core bake function — two-pass: subdivide then displace with smooth normals
// ---------------------------------------------------------------------------

const _v = new Vector3()
const _p = new Vector3()

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

  // Build texture targets (islands) for UV mapping projections
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
  const depthWorld = depthLevelToWorld(settings.depth)

  // ---- Pass 1: Subdivide each target WITHOUT displacement ----
  const perTargetPositions: number[][] = []
  for (const target of targets) {
    const tileWorld = BASE_TILE_WORLD / Math.max(0.05, settings.scale)
    const spacing = tileWorld / quality.samplesPerTile
    const levels = computeSubdivisionLevels(target.triangles, spacing, quality)

    const subPos: number[] = []
    const triCount = target.triangles.length / 9
    for (let t = 0; t < triCount; t++) {
      const o = t * 9
      const tri = target.triangles
      subdivideFlat(
        tri[o], tri[o + 1], tri[o + 2],
        tri[o + 3], tri[o + 4], tri[o + 5],
        tri[o + 6], tri[o + 7], tri[o + 8],
        levels[t], subPos,
      )
    }
    perTargetPositions.push(subPos)
  }

  // Combine all subdivided (un-displaced) positions
  let totalSubFloats = 0
  for (const sub of perTargetPositions) totalSubFloats += sub.length
  const combinedPositions = new Float32Array(totalSubFloats)
  let writeOffset = 0
  for (const sub of perTargetPositions) {
    for (let i = 0; i < sub.length; i++) {
      combinedPositions[writeOffset++] = sub[i]
    }
  }

  // ---- Compute smooth per-vertex normals via merge + computeVertexNormals ----
  // Merging shares vertices at island boundaries so smooth normals blend
  // across edges instead of each island displacing in its own direction.
  const subGeo = new BufferGeometry()
  subGeo.setAttribute('position', new Float32BufferAttribute(combinedPositions, 3))
  const mergedSub = mergeVertices(subGeo, 1e-4)
  subGeo.dispose()
  mergedSub.computeVertexNormals()

  const mergedNor = mergedSub.getAttribute('normal')
  const mergedIdx = mergedSub.getIndex()!

  // ---- Pass 2: Displace each vertex using smooth normal + target projection ----
  const worldDisplacedPositions: number[] = []
  let globalVertIdx = 0

  for (let ti = 0; ti < targets.length; ti++) {
    const sub = perTargetPositions[ti]
    const projection = targets[ti].projection
    const vertCount = sub.length / 3

    for (let vi = 0; vi < vertCount; vi++) {
      const x = sub[vi * 3], y = sub[vi * 3 + 1], z = sub[vi * 3 + 2]

      // UV mapping uses the per-island projection (correct per-face)
      _p.set(
        x - projection.originWorld.x,
        y - projection.originWorld.y,
        z - projection.originWorld.z,
      )
      const uWorld = _p.dot(projection.tangentWorld)
      const vWorld = _p.dot(projection.bitangentWorld)

      const mask = sampleReliefHeight(patternId, uWorld, vWorld, settings, imageData)
      const disp = getReliefDisplacement(mask, settings.mode, depthWorld)

      // Displacement direction uses the smooth normal (shared at boundaries)
      const mi = mergedIdx.getX(globalVertIdx)
      const nx = mergedNor.getX(mi), ny = mergedNor.getY(mi), nz = mergedNor.getZ(mi)

      worldDisplacedPositions.push(x + nx * disp, y + ny * disp, z + nz * disp)
      globalVertIdx++
    }
  }

  mergedSub.dispose()

  // Transform displaced world positions back to local space
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

  // Merge non-selected (unchanged) + displaced positions
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
