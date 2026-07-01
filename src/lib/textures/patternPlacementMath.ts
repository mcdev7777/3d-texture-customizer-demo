import type { Texture } from 'three'
import type { SurfacePatternSettings } from '../../types/pattern'

export const PATTERN_OFFSET_SCALE = 0.35

/** World displacement (in normalized model units) for one unit of depth level. */
export const DEPTH_WORLD_PER_LEVEL = 0.04
export const MAX_DEPTH_LEVEL = 3

export function getPatternRepeat(scale: number): number {
  return Math.max(0.25, scale) * 2
}

/** Convert a depth slider level (0.1–3.0) into a safe world-space displacement. */
export function depthLevelToWorld(level: number): number {
  const clamped = Math.min(MAX_DEPTH_LEVEL, Math.max(0, level))
  return clamped * DEPTH_WORLD_PER_LEVEL
}

/** Apply the same transform used by preview overlays to a Three.js texture. */
export function applyPatternTextureTransform(
  texture: Texture,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
): void {
  const repeat = getPatternRepeat(settings.scale)
  texture.repeat.set(repeat, repeat)
  texture.center.set(0.5, 0.5)
  texture.rotation = (settings.rotation * Math.PI) / 180
  texture.offset.set(
    settings.offsetX * PATTERN_OFFSET_SCALE,
    -settings.offsetY * PATTERN_OFFSET_SCALE,
  )
  texture.needsUpdate = true
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

/** Sample normalized height (0–1) from RGBA image data at pattern UV. */
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
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance * a + (1 - a) * 0.08
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
