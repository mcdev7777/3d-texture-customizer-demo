import type { PatternMode, SurfacePatternSettings } from '../../types/pattern'
import { evaluatePattern, smoothstep } from './patternEvaluators'

/** Offset slider range mapped to a fraction of one pattern tile. */
export const PATTERN_OFFSET_SCALE = 1

/**
 * Physical size (in normalized model units) of one pattern tile at scale 1.
 * Using a world-space tile keeps pattern density consistent across differently
 * sized surfaces/islands instead of stretching to each patch's bounds.
 */
export const BASE_TILE_WORLD = 0.6

/**
 * World displacement (in normalized model units) for one unit of depth level.
 * Models are normalized to a few units across, so the default depth (level 1.0)
 * gives clearly readable relief without deforming the model.
 */
export const DEPTH_WORLD_PER_LEVEL = 0.11
export const MAX_DEPTH_LEVEL = 3

/** Contrast applied to mask values so pattern edges stay crisp. */
const MASK_CONTRAST = 1.35

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Convert a depth slider level (0.1–3.0) into a safe world-space displacement. */
export function depthLevelToWorld(level: number): number {
  const clamped = Math.min(MAX_DEPTH_LEVEL, Math.max(0, level))
  return clamped * DEPTH_WORLD_PER_LEVEL
}

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
): number {
  const shaped = applyRoundedProfile(applyContrast(maskValue))
  return mode === 'engrave' ? (1 - shaped) * depthWorld : shaped * depthWorld
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
): [number, number] {
  const tile = BASE_TILE_WORLD / Math.max(0.05, settings.scale)
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
): number {
  const [pu, pv] = worldToPatternUV(uWorld, vWorld, settings)

  const procedural = evaluatePattern(patternId, pu, pv)
  if (procedural !== null) return procedural

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
  return 0
}
