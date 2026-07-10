import { Vector3 } from 'three'
import type { PatternId, SurfacePatternSettings } from '../../types/pattern'
import { patternScaleU, patternScaleV } from '../../types/pattern'
import type { ExportQuality } from '../../types/bake'
import { DEFAULT_EXPORT_QUALITY } from '../../types/bake'
import type { SelectionMode } from '../../types/surfaceSelection'
import type { PatternBounds } from '../materials/patternBounds'
import type { SurfaceProjection } from '../geometry/surfaceProjection'
import { getQualityConfig } from '../geometry/subdivideSelection'
import { getSelectionTileWorld } from './patternPlacementMath'
import { evaluatePattern } from './patternEvaluators'
import { getPatternImageData } from '../../utils/patternTextures'
import { getPatternTextureAspect } from '../materials/patternTexture'
import { sampleImageHeight, shapeHeightSample } from './heightMapSampler'

export interface ProjectionContext {
  patternId: PatternId
  settings: SurfacePatternSettings
  mappingMode: SelectionMode
  projection: SurfaceProjection
  bounds: PatternBounds
  imageData: ImageData | null
  aspectU: number
  aspectV: number
  tileWorld: number
}

const _rel = new Vector3()

function worldCoordsToPatternUV(rawU: number, rawV: number, ctx: ProjectionContext): [number, number] {
  const { settings, projection, mappingMode } = ctx
  const scaleU = Math.max(0.05, patternScaleU(settings))
  const scaleV = Math.max(0.05, patternScaleV(settings))

  let pu: number
  let pv: number

  if (mappingMode === 'part') {
    // Cubic path passes 0–1 part-local coords; scale multiplies repeat count.
    pu = rawU * scaleU
    pv = rawV * scaleV
  } else {
    // Planar: map selection tangent space to 0–1 at scale 1, centered on origin.
    pu = (rawU / Math.max(projection.width, 1e-6) + 0.5) * scaleU
    pv = (rawV / Math.max(projection.height, 1e-6) + 0.5) * scaleV
  }

  const rad = (settings.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  pu -= 0.5
  pv -= 0.5
  const ru = cos * pu - sin * pv
  const rv = sin * pu + cos * pv
  pu = ru + 0.5 + settings.offsetX
  pv = rv + 0.5 + settings.offsetY
  return [pu, pv]
}

function sampleHeightAtPatternUV(pu: number, pv: number, ctx: ProjectionContext): number {
  // Match shader preview: sample the pattern heightmap texture when available.
  const raw = ctx.imageData
    ? sampleImageHeight(ctx.imageData, pu, pv, true)
    : (evaluatePattern(ctx.patternId, pu, pv) ?? 0)
  return shapeHeightSample(raw, {
    invert: ctx.settings.invert ?? false,
    smoothing: ctx.settings.smoothing ?? 0,
  })
}

function sampleMapHeight(rawU: number, rawV: number, ctx: ProjectionContext): number {
  const [pu, pv] = worldCoordsToPatternUV(rawU, rawV, ctx)
  return sampleHeightAtPatternUV(pu, pv, ctx)
}

function samplePlanarHeight(worldPos: Vector3, ctx: ProjectionContext): number {
  _rel.copy(worldPos).sub(ctx.projection.originWorld)
  return sampleMapHeight(_rel.dot(ctx.projection.tangentWorld), _rel.dot(ctx.projection.bitangentWorld), ctx)
}

const CUBIC_AXIS_EPSILON = 1e-4

function dominantAxis(n: Vector3): 'x' | 'y' | 'z' {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  if (ax >= ay - CUBIC_AXIS_EPSILON && ax >= az - CUBIC_AXIS_EPSILON) return 'x'
  if (ay >= az - CUBIC_AXIS_EPSILON) return 'y'
  return 'z'
}

function sampleCubicHeight(worldPos: Vector3, faceNormal: Vector3, ctx: ProjectionContext): number {
  const min = ctx.bounds.min
  const size = ctx.bounds.size
  const md = Math.max(size.x, size.y, size.z, 1e-4)

  let yzU = (worldPos.y - min.y) / md
  if (faceNormal.x < 0) yzU = -yzU
  let xzU = (worldPos.x - min.x) / md
  if (faceNormal.y > 0) xzU = -xzU
  let xyU = (worldPos.x - min.x) / md
  if (faceNormal.z < 0) xyU = -xyU

  const hXY = sampleMapHeight(xyU, (worldPos.y - min.y) / md, ctx)
  const hXZ = sampleMapHeight(xzU, (worldPos.z - min.z) / md, ctx)
  const hYZ = sampleMapHeight(yzU, (worldPos.z - min.z) / md, ctx)

  const axis = dominantAxis(faceNormal)
  return axis === 'x' ? hYZ : axis === 'y' ? hXZ : hXY
}

export function samplePatternHeightAtWorld(
  worldPos: Vector3,
  worldNormal: Vector3,
  ctx: ProjectionContext,
): number {
  if (ctx.mappingMode === 'part') return sampleCubicHeight(worldPos, worldNormal, ctx)
  return samplePlanarHeight(worldPos, ctx)
}

export function createProjectionContext(
  patternId: PatternId,
  settings: SurfacePatternSettings,
  mappingMode: SelectionMode,
  projection: SurfaceProjection,
  bounds: PatternBounds,
  _exportUnitScale: number,
  exportQuality: ExportQuality = DEFAULT_EXPORT_QUALITY,
): ProjectionContext {
  const aspect = getPatternTextureAspect(patternId)
  const tileWorld = getSelectionTileWorld(projection, aspect.u, aspect.v, settings.scale)
  const textureSize = getQualityConfig(exportQuality).textureSize

  return {
    patternId,
    settings,
    mappingMode,
    projection,
    bounds,
    imageData: getPatternImageData(patternId, textureSize),
    aspectU: aspect.u,
    aspectV: aspect.v,
    tileWorld,
  }
}
