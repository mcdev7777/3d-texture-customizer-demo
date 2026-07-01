import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'
import type { PatternId } from '../../types/pattern'
import type { SurfacePatternSettings } from '../../types/pattern'
import { getPatternCanvas } from '../../utils/patternTextures'
import { applyPatternTextureTransform } from './patternPlacementMath'

/** Create a dedicated texture for a baked patch with placement transforms applied. */
export function createPatternTextureForPlacement(
  patternId: PatternId,
  settings: Pick<SurfacePatternSettings, 'scale' | 'rotation' | 'offsetX' | 'offsetY'>,
): Texture | null {
  try {
    const canvas = getPatternCanvas(patternId, 512)
    const texture = new CanvasTexture(canvas)
    texture.wrapS = RepeatWrapping
    texture.wrapT = RepeatWrapping
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 4
    applyPatternTextureTransform(texture, settings)
    return texture
  } catch {
    return null
  }
}
