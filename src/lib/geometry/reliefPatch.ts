import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Vector3,
  type Material,
} from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { SurfacePatternSettings } from '../../types/pattern'
import {
  BASE_TILE_WORLD,
  depthLevelToWorld,
  getReliefDisplacement,
  sampleReliefHeight,
} from '../textures/patternPlacementMath'
import { getPatternImageData } from '../../utils/patternTextures'
import { hasProceduralEvaluator } from '../textures/patternEvaluators'
import { markIgnoreRaycast } from '../three/raycastUtils'
import { createAppliedTextureMaterial, type PatchRole } from './bakePatternGeometry'
import { buildTextureTargets, type TextureTarget } from './textureTargets'
import type { SurfaceProjection } from './surfaceProjection'
import type { SelectedSurface } from '../../types/surfaceSelection'

export type { PatchRole }

/** Tiny outward lift so the relief never z-fights the base surface. */
const BASE_OFFSET = 0.0015

interface Quality {
  samplesPerTile: number
  maxLevel: number
  budgetPerTarget: number
}

const PREVIEW_QUALITY: Quality = { samplesPerTile: 5, maxLevel: 5, budgetPerTarget: 30_000 }
const COMMITTED_QUALITY: Quality = { samplesPerTile: 7, maxLevel: 6, budgetPerTarget: 80_000 }

function edgeLength(t: number[], i: number, j: number): number {
  const dx = t[i] - t[j]
  const dy = t[i + 1] - t[j + 1]
  const dz = t[i + 2] - t[j + 2]
  return Math.hypot(dx, dy, dz)
}

/** Choose a subdivision level per triangle from its size vs the target sample spacing. */
function computeLevels(triangles: number[], spacing: number, quality: Quality): number[] {
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
    const level = Math.min(quality.maxLevel, Math.max(0, Math.ceil(Math.log2(Math.max(1, ratio)))))
    levels[t] = level
    total += 4 ** level
  }

  // Keep the whole target within budget by trimming levels uniformly.
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

function displaceInto(x: number, y: number, z: number, ctx: DisplaceContext, out: number[]): void {
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
  const disp = getReliefDisplacement(mask, ctx.settings.mode, ctx.depthWorld) + BASE_OFFSET
  out.push(x + ctx.dir.x * disp, y + ctx.dir.y * disp, z + ctx.dir.z * disp)
}

/** Recursively 4-split a triangle to `level`, displacing each leaf vertex. */
function subdivide(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  level: number,
  ctx: DisplaceContext,
  out: number[],
): void {
  if (level <= 0) {
    displaceInto(ax, ay, az, ctx, out)
    displaceInto(bx, by, bz, ctx, out)
    displaceInto(cx, cy, cz, ctx, out)
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

function buildTargetGeometry(
  target: TextureTarget,
  settings: SurfacePatternSettings,
  imageData: ImageData | null,
  quality: Quality,
): BufferGeometry | null {
  const projection: SurfaceProjection = target.projection
  const tileWorld = BASE_TILE_WORLD / Math.max(0.05, settings.scale)
  const spacing = tileWorld / quality.samplesPerTile

  const levels = computeLevels(target.triangles, spacing, quality)

  const ctx: DisplaceContext = {
    origin: projection.originWorld,
    tangent: projection.tangentWorld,
    bitangent: projection.bitangentWorld,
    // Displace all triangles of a target along one consistent direction so shared
    // edges weld cleanly (no cracks/spikes) while the pattern stays aligned.
    dir: projection.normalWorld,
    settings,
    depthWorld: depthLevelToWorld(settings.depth),
    imageData,
  }

  const positions: number[] = []
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
      positions,
    )
  }

  if (positions.length === 0) return null

  const raw = new BufferGeometry()
  raw.setAttribute('position', new Float32BufferAttribute(positions, 3))

  // Weld coincident vertices then compute smooth normals so the relief reads as
  // rounded rather than faceted, while island boundaries keep their hard edges.
  const geometry = mergeVertices(raw, 1e-4)
  raw.dispose()
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Build a group of relief meshes — one per texture target (surface island).
 * Preview and Apply share this builder, so results are identical apart from a
 * faint preview tint and a lighter tessellation budget.
 */
export function buildReliefGroup(
  surfaceId: string,
  targets: TextureTarget[],
  settings: SurfacePatternSettings,
  options: { role: PatchRole; sourceMaterial?: Material | Material[] | null },
): { group: Group; warnings: string[] } {
  const material = createAppliedTextureMaterial(options.sourceMaterial, options.role)
  const quality = options.role === 'preview' ? PREVIEW_QUALITY : COMMITTED_QUALITY

  const patternId = settings.patternId as string
  const imageData = hasProceduralEvaluator(patternId) ? null : getPatternImageData(patternId)

  const group = new Group()
  group.name = options.role === 'preview' ? 'PreviewPatchGroup' : 'CommittedPatchGroup'
  group.userData.surfaceId = surfaceId
  group.userData.isPreview = options.role === 'preview'
  group.userData.isPreviewTexture = options.role === 'preview'
  group.userData.isCommittedPatch = options.role === 'committed'
  group.userData.exportable = options.role === 'committed'
  group.userData.excludeFromExport = options.role === 'preview'

  const warnings: string[] = []
  for (const target of targets) {
    const geometry = buildTargetGeometry(target, settings, imageData, quality)
    if (!geometry) continue
    const mesh = new Mesh(geometry, material)
    mesh.name = options.role === 'preview' ? 'PreviewPatch' : 'CommittedPatch'
    mesh.userData.isPreview = options.role === 'preview'
    mesh.userData.isPreviewTexture = options.role === 'preview'
    mesh.userData.isCommittedPatch = options.role === 'committed'
    mesh.userData.exportable = options.role === 'committed'
    mesh.userData.excludeFromExport = options.role === 'preview'
    markIgnoreRaycast(mesh)
    group.add(mesh)
  }

  if (group.children.length === 0) {
    warnings.push('Could not build texture relief for this selection.')
  }
  return { group, warnings }
}

/**
 * Build a relief group directly from the live selection. Surface selections yield
 * one island; part selections are split into planar islands (one per major face)
 * so each face is mapped correctly. Preview and Apply both call this so their
 * results are identical.
 */
export function buildReliefForSelection(
  surface: SelectedSurface,
  settings: SurfacePatternSettings,
  options: { role: PatchRole; sourceMaterial?: Material | Material[] | null },
): { group: Group; warnings: string[] } {
  const targets = buildTextureTargets(
    surface.highlightGeometry,
    surface.normal,
    surface.point,
    surface.selectionType,
  )
  return buildReliefGroup(surface.surfaceId, targets, settings, options)
}
