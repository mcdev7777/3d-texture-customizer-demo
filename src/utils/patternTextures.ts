import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three'
import type { PatternCategory, PatternId } from '../types/pattern'

export interface PatternDefinition {
  id: PatternId
  label: string
  category: PatternCategory
  defaultScale: number
  defaultDepth: number
  tileable: boolean
}

export const PATTERN_DEFINITIONS: PatternDefinition[] = [
  { id: 'hex', label: 'Hex', category: 'geometric', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'grid', label: 'Grid', category: 'geometric', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'diamond', label: 'Diamond', category: 'geometric', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'honeycomb', label: 'Honeycomb', category: 'geometric', defaultScale: 1, defaultDepth: 1.2, tileable: true },
  { id: 'scales', label: 'Scales', category: 'organic', defaultScale: 1, defaultDepth: 1.2, tileable: true },
  { id: 'ribbed', label: 'Ribbed Lines', category: 'lines', defaultScale: 1, defaultDepth: 1.4, tileable: true },
  { id: 'dots', label: 'Dots', category: 'geometric', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'waves', label: 'Waves', category: 'organic', defaultScale: 1, defaultDepth: 1.2, tileable: true },
  { id: 'zigzag', label: 'Zigzag', category: 'lines', defaultScale: 1, defaultDepth: 1.2, tileable: true },
  { id: 'brick', label: 'Brick', category: 'surface', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'crosshatch', label: 'Crosshatch', category: 'lines', defaultScale: 1, defaultDepth: 1, tileable: true },
  { id: 'cracks', label: 'Cracks', category: 'surface', defaultScale: 1.2, defaultDepth: 1.4, tileable: false },
]

const INK = '#f4f4f8'
const BG = '#0c0c12'

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void

function fill(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

const PATTERN_DRAWERS: Record<PatternId, DrawFn> = {
  hex(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.018
    const r = size / 6
    const w = r * Math.sqrt(3)
    const h = r * 1.5
    for (let row = -1; row * h < size + h; row++) {
      for (let col = -1; col * w < size + w; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0)
        const cy = row * h
        hexPath(ctx, cx, cy, r)
        ctx.stroke()
      }
    }
  },

  grid(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.03
    const step = size / 6
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

  diamond(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.02
    const step = size / 5
    ctx.save()
    ctx.translate(size / 2, size / 2)
    ctx.rotate(Math.PI / 4)
    ctx.translate(-size / 2, -size / 2)
    for (let x = -size; x <= size * 2; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, -size)
      ctx.lineTo(x, size * 2)
      ctx.stroke()
    }
    for (let y = -size; y <= size * 2; y += step) {
      ctx.beginPath()
      ctx.moveTo(-size, y)
      ctx.lineTo(size * 2, y)
      ctx.stroke()
    }
    ctx.restore()
  },

  honeycomb(ctx, size) {
    fill(ctx, size)
    const r = size / 6
    const w = r * Math.sqrt(3)
    const h = r * 1.5
    for (let row = -1; row * h < size + h; row++) {
      for (let col = -1; col * w < size + w; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0)
        const cy = row * h
        hexPath(ctx, cx, cy, r * 0.92)
        ctx.fill()
      }
    }
  },

  scales(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.02
    const cols = 6
    const step = size / cols
    const r = step * 0.62
    for (let row = -1; row * (step * 0.6) < size + step; row++) {
      const offset = row % 2 ? step / 2 : 0
      const cy = row * step * 0.6
      for (let col = -1; col * step < size + step; col++) {
        const cx = col * step + offset
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI)
        ctx.stroke()
      }
    }
  },

  ribbed(ctx, size) {
    fill(ctx, size)
    const bars = 7
    const step = size / bars
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(0, i * step + step * 0.2, size, step * 0.6)
    }
  },

  dots(ctx, size) {
    fill(ctx, size)
    const step = size / 7
    const r = step * 0.3
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  },

  waves(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.03
    const rows = 6
    const amp = size * 0.06
    const freq = (Math.PI * 2 * 2) / size
    for (let row = 0; row <= rows; row++) {
      const yBase = (row / rows) * size
      ctx.beginPath()
      for (let x = 0; x <= size; x += 2) {
        const y = yBase + Math.sin(x * freq) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  },

  zigzag(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.03
    const rows = 6
    const step = size / rows
    const peak = step * 0.5
    for (let row = 0; row <= rows; row++) {
      const yBase = row * step
      ctx.beginPath()
      let up = true
      for (let x = 0; x <= size; x += step) {
        const y = yBase + (up ? -peak : peak)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        up = !up
      }
      ctx.stroke()
    }
  },

  brick(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.022
    const rows = 6
    const rowH = size / rows
    const brickW = size / 3
    for (let row = 0; row < rows; row++) {
      const y = row * rowH
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
      const offset = row % 2 ? brickW / 2 : 0
      for (let x = offset; x <= size; x += brickW) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + rowH)
        ctx.stroke()
      }
    }
  },

  crosshatch(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.016
    const step = size / 7
    for (let i = -size; i < size * 2; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + size, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i, size)
      ctx.lineTo(i + size, 0)
      ctx.stroke()
    }
  },

  cracks(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.02
    const nodes = 9
    const seeds: Array<[number, number]> = []
    let s = 1337
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
    for (let i = 0; i < nodes; i++) {
      seeds.push([rand() * size, rand() * size])
    }
    for (let i = 0; i < seeds.length; i++) {
      const [x0, y0] = seeds[i]
      const branches = 2 + Math.floor(rand() * 2)
      for (let b = 0; b < branches; b++) {
        const target = seeds[(i + 1 + b) % seeds.length]
        const midX = (x0 + target[0]) / 2 + (rand() - 0.5) * size * 0.2
        const midY = (y0 + target[1]) / 2 + (rand() - 0.5) * size * 0.2
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.quadraticCurveTo(midX, midY, target[0], target[1])
        ctx.stroke()
      }
    }
  },
}

const textureCache = new Map<PatternId, CanvasTexture>()
const thumbnailCache = new Map<PatternId, string>()

export function getPatternDefinition(patternId: PatternId): PatternDefinition {
  return PATTERN_DEFINITIONS.find((d) => d.id === patternId) ?? PATTERN_DEFINITIONS[0]
}

export function getPatternCanvas(patternId: PatternId, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const drawer = PATTERN_DRAWERS[patternId] ?? PATTERN_DRAWERS.grid
  drawer(ctx, size)
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

/** Independent texture instance for an overlay (do not mutate the shared cache). */
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

  const canvas = getPatternCanvas(patternId, 96)
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
