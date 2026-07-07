import type { Object3D } from 'three'
import type { PatternMode, SurfacePatternSettings } from '../../types/pattern'
import { DEPTH_MAX, DEPTH_MIN } from '../../types/pattern'
import { evaluatePattern, smoothstep } from './patternEvaluators'

/** Offset slider range mapped to a fraction of one pattern tile. */
export const PATTERN_OFFSET_SCALE = 1

/**
 * Physical tile size in millimeters at pattern scale 1.
 * Viewer tile size is derived via exportUnitScale so preview matches export.
 */
export const BASE_TILE_MM = 0.6

/** @deprecated Use BASE_TILE_MM — kept for existing imports. */
export const BASE_TILE_WORLD = BASE_TILE_MM

export function getExportUnitScale(modelRoot: Object3D | null | undefined): number {
  let root = modelRoot ?? null
  while (root) {
    const scale = root.userData?.exportUnitScale
    if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) return scale
    root = root.parent
  }
  return 1
}

/** Viewer-space tile width for pattern mapping at the given scale. */
export function getPatternTileWorld(scale: number, exportUnitScale: number): number {
  return BASE_TILE_MM / (Math.max(0.05, scale) * Math.max(exportUnitScale, 1e-6))
}

/**
 * Tile world size so one pattern period spans the selection at scale 1.
 * Higher scale → more repeats (scale 2 ≈ 4 tiles on a square selection).
 */
export function getSelectionTileWorld(
  projection: { width: number; height: number },
  aspectU: number,
  aspectV: number,
  scale: number,
): number {
  const s = Math.max(0.05, scale)
  const extentU = Math.max(projection.width, 1e-6) * aspectU
  const extentV = Math.max(projection.height, 1e-6) * aspectV
  return Math.max(extentU, extentV) / s
}

/**
 * Bump strength at minimum and maximum depth slider values.
 * Mapped with a smooth curve so low depths stay subtle and max depth reads clearly.
 */
export const DEPTH_BUMP_MIN = 0.15
export const DEPTH_BUMP_MAX = 3.2

/** @deprecated Legacy linear scale — prefer depthLevelToWorld(). */
export const DEPTH_WORLD_PER_LEVEL = 0.11
export const MAX_DEPTH_LEVEL = DEPTH_MAX

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Convert a depth slider level (0.1–3.0) into shader bump strength. */
export function depthLevelToWorld(level: number): number {
  const clamped = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, level))
  const t = (clamped - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN)
  const curved = t * t * (3 - 2 * t)
  return DEPTH_BUMP_MIN + curved * (DEPTH_BUMP_MAX - DEPTH_BUMP_MIN)
}

/** Contrast applied to mask values so pattern edges stay crisp. */
const MASK_CONTRAST = 1.35

export function applyContrast(value: number, contrast = MASK_CONTRAST): number {
  return clamp01((value - 0.5) * contrast + 0.5)
}

/** Rounded relief profile so raised shapes have soft domed tops, not vertical walls. */
export function applyRoundedProfile(value: number): number {
  const h = clamp01(value)
  return h * h * (3 - 2 * h)
}

/**
 * Convert a mask value (0–1) into a signed local displacement along the surface
 * normal, with a rounded profile.
 *
 * Both modes keep geometry at or above the base surface so nothing is occluded
 * by the underlying mesh:
 * - Emboss: background flat, mask raised outward with soft domed tops.
 * - Engrave: a thin raised slab with the mask carved back to the surface, which
 *   reads as recessed grooves (a demo-safe alternative to a true boolean cut).
 */
export function getReliefDisplacement(
  maskValue: number,
  mode: PatternMode,
  depthWorld: number,
  inverted = false,
): number {
  const shaped = applyRoundedProfile(applyContrast(maskValue))
  const ink = inverted ? shaped : 1 - shaped
  const raised = mode === 'engrave' ? 1 - ink : ink
  return raised * depthWorld
}

/**
 * Map an in-plane world coordinate (along tangent/bitangent, in model units)
 * to a pattern-space coordinate, applying scale (as tile size), rotation, and
 * offset. The result is unwrapped; evaluators/samplers wrap to the unit tile.
 */
export function worldToPatternUV(
  uWorld: number,
  vWorld: number,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
  exportUnitScale = 1,
): [number, number] {
  const tile = getPatternTileWorld(settings.scale, exportUnitScale)
  const rad = (settings.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const ru = uWorld * cos - vWorld * sin
  const rv = uWorld * sin + vWorld * cos

  const pu = ru / tile + settings.offsetX * PATTERN_OFFSET_SCALE
  const pv = rv / tile + settings.offsetY * PATTERN_OFFSET_SCALE
  return [pu, pv]
}

function frac(x: number): number {
  return x - Math.floor(x)
}

/** Bilinear grayscale sample (0–1) from RGBA image data with tiling wrap. */
export function sampleImageHeightBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const fx = frac(u) * width - 0.5
  const fy = frac(1 - v) * height - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0

  const lum = (px: number, py: number): number => {
    const wx = ((px % width) + width) % width
    const wy = ((py % height) + height) % height
    const idx = (wy * width + wx) * 4
    const a = data[idx + 3] / 255
    return (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255 * a
  }

  const top = lum(x0, y0) * (1 - tx) + lum(x0 + 1, y0) * tx
  const bottom = lum(x0, y0 + 1) * (1 - tx) + lum(x0 + 1, y0 + 1) * tx
  return top * (1 - ty) + bottom * ty
}

/**
 * Unified height sampler used by preview and apply. Built-in patterns use smooth
 * procedural evaluators; custom uploads and non-procedural patterns fall back to
 * bilinear bitmap sampling. In every case the image is only a height mask.
 */
export function sampleReliefHeight(
  patternId: string,
  uWorld: number,
  vWorld: number,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
  fallbackImage: ImageData | null,
  exportUnitScale = 1,
): number {
  const [pu, pv] = worldToPatternUV(uWorld, vWorld, settings, exportUnitScale)

  if (fallbackImage) {
    const raw = sampleImageHeightBilinear(
      fallbackImage.data,
      fallbackImage.width,
      fallbackImage.height,
      pu,
      pv,
    )
    return smoothstep(0.08, 0.95, raw)
  }

  const procedural = evaluatePattern(patternId, pu, pv)
  if (procedural !== null) return procedural

  return 0
}
