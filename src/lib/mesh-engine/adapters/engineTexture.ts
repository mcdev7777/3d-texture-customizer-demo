import type { PatternId, SurfacePatternSettings } from '../../../types/pattern'
import type { ExportQuality } from '../../../types/bake'
import { EXPORT_QUALITY } from '../../geometry/subdivideSelection'
import { getPatternCanvas } from '../../../utils/patternTextures'
import { getPatternImageData } from '../../../utils/patternTextures'
import { evaluatePattern } from '../../textures/patternEvaluators'
import { shapeHeightSample } from '../../textures/heightMapSampler'

function raisedFromHeight(raw: number, settings: SurfacePatternSettings): number {
  let h = shapeHeightSample(raw, {
    invert: settings.invert ?? false,
    smoothing: settings.smoothing ?? 0,
  })
  const ink = settings.invert ? h : 1 - h
  return settings.mode === 'engrave' ? 1 - ink : ink
}

/**
 * Encode relief as BumpMesh greyscale. The pipeline's default (non-symmetric)
 * displacement is `disp = grey * amplitude`, i.e. grey 0 = no displacement and
 * grey 1 = full height — so `raised` maps straight to grey. This keeps flat
 * (raised = 0) tones at exactly 0mm and raised (raised = 1) tones at the full
 * depth, matching the emboss/engrave intent: in emboss, ink/black rises to
 * `depth` and white stays at 0; in engrave the roles swap.
 *
 * In symmetric mode the pipeline re-centers this (`grey - 0.5`) so raised tones
 * push outward and flat tones push inward equally.
 */
function encodeBumpMeshGrey(raised: number): number {
  return Math.round(Math.min(1, Math.max(0, raised)) * 255)
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
      const raised = raisedFromHeight(raw, settings)
      const byte = encodeBumpMeshGrey(raised)
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
    const raised = raisedFromHeight(lum, settings)
    const byte = encodeBumpMeshGrey(raised)
    out[i] = byte
    out[i + 1] = byte
    out[i + 2] = byte
    out[i + 3] = 255
  }
  return new ImageData(out, width, height)
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
): DisplacementTexture {
  const size = EXPORT_QUALITY[quality].textureSize

  const custom = getPatternImageData(patternId, size)
  if (custom) {
    const imageData = convertCanvasToBumpMeshImage(custom, settings)
    return { imageData, width: imageData.width, height: imageData.height }
  }

  const canvas = getPatternCanvas(patternId, size)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const source = ctx.getImageData(0, 0, size, size)
    const imageData = convertCanvasToBumpMeshImage(source, settings)
    return { imageData, width: size, height: size }
  }

  const imageData = rasterizeProcedural(patternId, settings, size)
  return { imageData, width: size, height: size }
}
