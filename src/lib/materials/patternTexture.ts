import { CanvasTexture, RepeatWrapping, type Texture } from 'three'
import type { PatternId } from '../../types/pattern'
import { getPatternCanvas, getPatternTileAspect } from '../../utils/patternTextures'

const textureCache = new Map<string, Texture>()

const TEXTURE_CACHE_VERSION = 'v4'

/** Grayscale height-map texture for shader sampling (repeat wrapping). */
export function getPatternTexture(patternId: PatternId, size = 512): Texture {
  const key = `${patternId}@${size}@${TEXTURE_CACHE_VERSION}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const canvas = getPatternCanvas(patternId, size)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = 'srgb'
  texture.needsUpdate = true
  textureCache.set(key, texture)
  return texture
}

export function getPatternTextureAspect(patternId: PatternId): { u: number; v: number } {
  return getPatternTileAspect(patternId)
}

export function disposePatternTextureCache(): void {
  for (const tex of textureCache.values()) tex.dispose()
  textureCache.clear()
}
