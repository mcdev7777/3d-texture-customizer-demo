import type { PatternId, SurfacePatternSettings } from '../../../types/pattern'
import type { ExportQuality } from '../../../types/bake'
import { EXPORT_QUALITY } from '../../geometry/subdivideSelection'
import { getPatternCanvas } from '../../../utils/patternTextures'
import { getPatternImageData } from '../../../utils/patternTextures'
import { evaluatePattern } from '../../textures/patternEvaluators'
import { shapeHeightSample } from '../../textures/heightMapSampler'

/**
 * The pattern's ink intensity (black = 1) as a [0,1] grey value, respecting
 * invert. This is the raw feature amount; the emboss/engrave direction is NOT
 * baked in here — it is applied as the sign of the layer amplitude (positive =
 * emboss/outward, negative = engrave/inward). White (ink 0) always stays flat.
 */
function inkFromHeight(raw: number, settings: SurfacePatternSettings): number {
  const h = shapeHeightSample(raw, {
    invert: settings.invert ?? false,
    smoothing: settings.smoothing ?? 0,
  })
  return settings.invert ? h : 1 - h
}

/**
 * Encode the ink intensity as BumpMesh greyscale. The pipeline's default
 * (non-symmetric) displacement is `disp = grey * amplitude`, i.e. grey 0 = no
 * displacement and grey 1 = full amplitude — so ink maps straight to grey.
 * White (ink 0) stays at exactly 0mm; full ink reaches the full amplitude. The
 * emboss/engrave direction is the SIGN of that amplitude (see buildLayerSettings
 * / bakeMeshRegions): emboss = +amplitude (ink rises outward), engrave =
 * −amplitude (ink carves inward), both leaving white flat.
 *
 * In symmetric mode the pipeline re-centers this (`grey - 0.5`) so ink tones
 * push one way and flat tones push the other equally.
 */
function encodeBumpMeshGrey(ink: number): number {
  return Math.round(Math.min(1, Math.max(0, ink)) * 255)
}

function rasterizeProcedural(
  patternId: PatternId,
  settings: SurfacePatternSettings,
  size: number,
): ImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const raw = evaluatePattern(patternId, u, v) ?? 0
      const ink = inkFromHeight(raw, settings)
      const byte = encodeBumpMeshGrey(ink)
      const i = (y * size + x) * 4
      data[i] = byte
      data[i + 1] = byte
      data[i + 2] = byte
      data[i + 3] = 255
    }
  }
  return new ImageData(data, size, size)
}

function convertCanvasToBumpMeshImage(
  source: ImageData,
  settings: SurfacePatternSettings,
): ImageData {
  const { width, height, data } = source
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const lum =
      (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255 *
      (data[i + 3]! / 255)
    const ink = inkFromHeight(lum, settings)
    const byte = encodeBumpMeshGrey(ink)
    out[i] = byte
    out[i + 1] = byte
    out[i + 2] = byte
    out[i + 3] = 255
  }
  return new ImageData(out, width, height)
}

/**
 * Separable box blur on the grey (relief) channel, with wrap-around at all
 * four borders so a tiling pattern stays seamless. Two passes approximate a
 * Gaussian. This anti-aliases the pattern's hard black→white boundaries: a
 * sharp step in the heightmap becomes a short ramp, so displacement builds a
 * clean sloped wall instead of the saw-tooth staircase you get when a vertical
 * cliff is sampled onto triangles that don't align with it. Alpha is left at
 * 255 (relief is encoded in R=G=B; the sampler only reads R).
 */
function blurGreyWrap(src: ImageData, radius: number): ImageData {
  const { width: w, height: h, data } = src
  if (radius < 1) return src

  // Extract grey (R) into a Float32 working buffer.
  let buf = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) buf[p] = data[p * 4]!
  let tmp = new Float32Array(w * h)

  const win = radius * 2 + 1
  const inv = 1 / win

  // Sliding-window (running-sum) box blur: O(w·h) per pass regardless of
  // radius, so a large radius on a 4096² texture stays cheap.
  const passes = 2
  for (let pass = 0; pass < passes; pass++) {
    // Horizontal (wrap in x).
    for (let y = 0; y < h; y++) {
      const row = y * w
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += buf[row + ((k % w + w) % w)]!
      tmp[row] = sum * inv
      for (let x = 1; x < w; x++) {
        const add = buf[row + ((x + radius) % w)]!
        const sub = buf[row + (((x - radius - 1) % w + w) % w)]!
        sum += add - sub
        tmp[row + x] = sum * inv
      }
    }
    // Vertical (wrap in y).
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += tmp[((k % h + h) % h) * w + x]!
      buf[x] = sum * inv
      for (let y = 1; y < h; y++) {
        const add = tmp[((y + radius) % h) * w + x]!
        const sub = tmp[(((y - radius - 1) % h + h) % h) * w + x]!
        sum += add - sub
        buf[y * w + x] = sum * inv
      }
    }
  }

  const out = new Uint8ClampedArray(data.length)
  for (let p = 0; p < w * h; p++) {
    const g = Math.round(buf[p]!)
    out[p * 4] = g
    out[p * 4 + 1] = g
    out[p * 4 + 2] = g
    out[p * 4 + 3] = 255
  }
  return new ImageData(out, w, h)
}

/** Blur ramp width as a fraction of texture width at smoothness 100. */
const MAX_BLUR_FRACTION = 0.035

/**
 * Blur radius in texels for a given Smoothness value (0–100), proportional to
 * texture resolution so the softening is consistent across quality settings.
 * The ramp must be wide enough (in world space) to span several triangles,
 * otherwise a hard step forms and the mesh smoother freezes it as a "sharp
 * edge" — the source of the saw-tooth print artifact.
 */
function smoothnessBlurRadius(value: number, size: number): number {
  const v = Math.max(0, Math.min(100, value))
  if (v <= 0) return 0
  const fraction = (v / 100) * MAX_BLUR_FRACTION
  return Math.max(1, Math.round(size * fraction))
}

export interface DisplacementTexture {
  imageData: ImageData
  width: number
  height: number
}

/** Build ImageData for BumpMesh displacement (0.5 = neutral, white = out). */
export function buildDisplacementTexture(
  patternId: PatternId,
  settings: SurfacePatternSettings,
  quality: ExportQuality,
  smoothnessLevel = 0,
): DisplacementTexture {
  const size = EXPORT_QUALITY[quality].textureSize
  const blurRadius = smoothnessBlurRadius(smoothnessLevel, size)
  const soften = (img: ImageData) => blurGreyWrap(img, blurRadius)

  const custom = getPatternImageData(patternId, size)
  if (custom) {
    const imageData = soften(convertCanvasToBumpMeshImage(custom, settings))
    return { imageData, width: imageData.width, height: imageData.height }
  }

  const canvas = getPatternCanvas(patternId, size)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const source = ctx.getImageData(0, 0, size, size)
    const imageData = soften(convertCanvasToBumpMeshImage(source, settings))
    return { imageData, width: imageData.width, height: imageData.height }
  }

  const imageData = soften(rasterizeProcedural(patternId, settings, size))
  return { imageData, width: imageData.width, height: imageData.height }
}
