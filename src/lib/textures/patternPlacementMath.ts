import type { PatternMode, SurfacePatternSettings } from '../../types/pattern'

export const PATTERN_OFFSET_SCALE = 0.35

/**
 * World displacement (in normalized model units) for one unit of depth level.
 * Models are normalized to roughly a few units across, so this makes the default
 * depth (level 1.0) produce clearly readable relief without deforming the model.
 */
export const DEPTH_WORLD_PER_LEVEL = 0.11
export const MAX_DEPTH_LEVEL = 3

/** Contrast applied to raw mask luminance so relief edges read crisply. */
const MASK_CONTRAST = 1.9

export function getPatternRepeat(scale: number): number {
  return Math.max(0.25, scale) * 2
}

/** Convert a depth slider level (0.1–3.0) into a safe world-space displacement. */
export function depthLevelToWorld(level: number): number {
  const clamped = Math.min(MAX_DEPTH_LEVEL, Math.max(0, level))
  return clamped * DEPTH_WORLD_PER_LEVEL
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Clamp a raw mask sample into the normalized 0–1 height range. */
export function normalizeHeightMask(value: number): number {
  return clamp01(value)
}

/** Push mid-grays toward 0/1 so pattern edges are sharp instead of washed out. */
export function applyMaskThresholdContrast(value: number, contrast = MASK_CONTRAST): number {
  return clamp01((value - 0.5) * contrast + 0.5)
}

/**
 * Convert a normalized 0–1 mask value into a signed local-Z displacement.
 *
 * Both modes keep geometry at or above the base surface so nothing is occluded
 * by the underlying mesh:
 * - Emboss: background flat, mask peaks raised outward.
 * - Engrave: a thin raised slab with the mask carved back down to the surface,
 *   which reads as a recessed/engraved pattern (a demo-safe alternative to a
 *   true boolean cut).
 */
export function getDisplacementAmount(
  maskValue: number,
  mode: PatternMode,
  depthWorld: number,
): number {
  const h = clamp01(maskValue)
  return mode === 'engrave' ? (1 - h) * depthWorld : h * depthWorld
}

/**
 * Map panel UV (0–1) to pattern canvas UV with repeat, rotation, and offset.
 * Matches Three.js CanvasTexture transform order used in preview.
 */
export function mapPanelUVToPatternUV(
  panelU: number,
  panelV: number,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
): [number, number] {
  const repeat = getPatternRepeat(settings.scale)
  const offsetU = settings.offsetX * PATTERN_OFFSET_SCALE
  const offsetV = -settings.offsetY * PATTERN_OFFSET_SCALE
  const rad = (settings.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let u = panelU - 0.5
  let v = panelV - 0.5
  const ru = u * cos - v * sin + 0.5
  const rv = u * sin + v * cos + 0.5

  const pu = ru * repeat + offsetU
  const pv = rv * repeat + offsetV

  return [wrapUnit(pu), wrapUnit(pv)]
}

function wrapUnit(value: number): number {
  return value - Math.floor(value)
}

/**
 * Sample a normalized, contrast-enhanced height (0–1) from RGBA image data.
 *
 * Height is luminance premultiplied by alpha (so transparent areas stay flat),
 * then contrast-stretched. This is used identically for built-in patterns and
 * uploaded custom textures — the image is only ever a height mask, never color.
 */
export function sampleHeightFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)))
  const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)))
  const idx = (y * width + x) * 4
  const r = data[idx] / 255
  const g = data[idx + 1] / 255
  const b = data[idx + 2] / 255
  const a = data[idx + 3] / 255
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return applyMaskThresholdContrast(normalizeHeightMask(luminance * a))
}

export function samplePatternHeight(
  imageData: ImageData,
  panelU: number,
  panelV: number,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
): number {
  const [u, v] = mapPanelUVToPatternUV(panelU, panelV, settings)
  return sampleHeightFromImageData(imageData.data, imageData.width, imageData.height, u, v)
}
