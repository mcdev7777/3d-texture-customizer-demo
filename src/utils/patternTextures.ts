import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'
import type { PatternId } from '../types/pattern'

export interface PatternDefinition {
  id: PatternId
  label: string
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  { id: 'diagonal', label: 'Diagonal Lines' },
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dots' },
  { id: 'waves', label: 'Waves' },
  { id: 'chevron', label: 'Chevron' },
  { id: 'mark', label: 'Mark' },
]

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void

const PATTERN_DRAWERS: Record<PatternId, DrawFn> = {
  diagonal(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#c4b5fd'
    ctx.lineWidth = 3
    const step = size / 8
    for (let i = -size; i < size * 2; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + size, size)
      ctx.stroke()
    }
  },

  grid(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#a78bfa'
    ctx.lineWidth = 2
    const step = size / 8
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, size)
      ctx.stroke()
    }
    for (let y = 0; y <= size; y += step) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
    }
  },

  dots(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#ddd6fe'
    const step = size / 8
    const r = step * 0.28
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  },

  waves(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 3
    const amp = size * 0.08
    const freq = (Math.PI * 2) / size
    for (let row = 0; row < 6; row++) {
      const yBase = (row + 1) * (size / 7)
      ctx.beginPath()
      for (let x = 0; x <= size; x += 2) {
        const y = yBase + Math.sin(x * freq * 2) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  },

  chevron(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#c4b5fd'
    ctx.lineWidth = 3
    const rows = 5
    const rowH = size / rows
    for (let row = 0; row < rows; row++) {
      const y = row * rowH + rowH * 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + rowH * 0.25)
      ctx.lineTo(size * 0.5, y - rowH * 0.25)
      ctx.lineTo(size, y + rowH * 0.25)
      ctx.stroke()
    }
  },

  mark(ctx, size) {
    ctx.fillStyle = '#0f1629'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#a78bfa'
    ctx.strokeStyle = '#ede9fe'
    ctx.lineWidth = 2
    const cx = size / 2
    const cy = size / 2
    const r = size * 0.28
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#0f1629'
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.55)
    ctx.lineTo(cx + r * 0.5, cy + r * 0.35)
    ctx.lineTo(cx - r * 0.5, cy + r * 0.35)
    ctx.closePath()
    ctx.fill()
  },
}

const textureCache = new Map<PatternId, CanvasTexture>()
const thumbnailCache = new Map<PatternId, string>()

export function getPatternCanvas(patternId: PatternId, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  PATTERN_DRAWERS[patternId](ctx, size)
  return canvas
}

export function createPatternTexture(patternId: PatternId): Texture {
  const cached = textureCache.get(patternId)
  if (cached) return cached

  const canvas = getPatternCanvas(patternId, 256)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true

  textureCache.set(patternId, texture)
  return texture
}

/** Independent texture instance for a surface overlay (do not mutate the shared cache). */
export function clonePatternTexture(patternId: PatternId): Texture {
  const clone = createPatternTexture(patternId).clone()
  clone.wrapS = RepeatWrapping
  clone.wrapT = RepeatWrapping
  clone.colorSpace = SRGBColorSpace
  clone.needsUpdate = true
  return clone
}

export function createPatternThumbnail(patternId: PatternId): string {
  const cached = thumbnailCache.get(patternId)
  if (cached) return cached

  const canvas = getPatternCanvas(patternId, 64)
  const url = canvas.toDataURL('image/png')
  thumbnailCache.set(patternId, url)
  return url
}

export function disposePatternTextures(): void {
  for (const texture of textureCache.values()) {
    texture.dispose()
  }
  textureCache.clear()
  thumbnailCache.clear()
}
