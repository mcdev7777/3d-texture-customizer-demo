import type { BuiltinPatternId, PatternCategory, PatternId } from '../types/pattern'

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

const INK = '#0a0a0a'
const BG = '#f5f5f5'

type DrawFn = (ctx: CanvasRenderingContext2D, size: number) => void

/** Default metadata for an uploaded custom texture (no built-in entry exists). */
const CUSTOM_PATTERN_DEFINITION: Omit<PatternDefinition, 'id'> = {
  label: 'Custom',
  category: 'custom',
  defaultScale: 1,
  defaultDepth: 1.4,
  tileable: true,
}

function fill(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

/** Flat-top hex grid metrics sized so `cols` columns span the tile width exactly. */
function hexGridMetrics(size: number, cols: number) {
  const r = size / (cols * Math.sqrt(3))
  return { r, w: Math.sqrt(3) * r, h: 1.5 * r, cols }
}

/** Draw a flat-top hex grid that tiles seamlessly left/right and top/bottom. */
function drawSeamlessHexGrid(
  ctx: CanvasRenderingContext2D,
  size: number,
  cols: number,
  lineWidthRatio: number,
  radiusScale = 1,
): void {
  const { r, w, h } = hexGridMetrics(size, cols)
  ctx.lineWidth = size * lineWidthRatio
  const rowCount = Math.ceil(size / h) + 2
  for (let row = -1; row < rowCount; row++) {
    const cy = row * h
    const colOffset = row % 2 ? w / 2 : 0
    for (let col = -1; col <= cols; col++) {
      const cx = col * w + colOffset
      hexPath(ctx, cx, cy, r * radiusScale)
      ctx.stroke()
    }
  }
  enforceTileWrap(ctx, size)
}

/** Copy inner edge pixels to the outer border so RepeatWrapping has no seam. */
function enforceTileWrap(ctx: CanvasRenderingContext2D, size: number): void {
  const imageData = ctx.getImageData(0, 0, size, size)
  const d = imageData.data
  const rowBytes = size * 4

  for (let y = 0; y < size; y++) {
    const row = y * rowBytes
    for (let c = 0; c < 4; c++) {
      d[row + c] = d[row + 4 + c]
      d[row + (size - 1) * 4 + c] = d[row + (size - 2) * 4 + c]
    }
  }

  for (let x = 0; x < size; x++) {
    for (let c = 0; c < 4; c++) {
      const top = x * 4 + c
      const bottom = (size - 1) * rowBytes + x * 4 + c
      d[top] = d[rowBytes + x * 4 + c]
      d[bottom] = d[(size - 2) * rowBytes + x * 4 + c]
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/** UV aspect correction for patterns whose vertical repeat period differs from horizontal. */
export function getPatternTileAspect(patternId: PatternId): { u: number; v: number } {
  if (patternId === 'hex' || patternId === 'honeycomb') {
    const cols = 4
    const rowPairs = 2
    return { u: 1, v: (rowPairs * 3) / (cols * Math.sqrt(3)) }
  }
  return { u: 1, v: 1 }
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

const PATTERN_DRAWERS: Record<BuiltinPatternId, DrawFn> = {
  hex(ctx, size) {
    fill(ctx, size)
    drawSeamlessHexGrid(ctx, size, 4, 0.028, 0.98)
  },

  grid(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.028
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
    enforceTileWrap(ctx, size)
  },

  diamond(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.032
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
    drawSeamlessHexGrid(ctx, size, 4, 0.032, 0.96)
  },

  scales(ctx, size) {
    fill(ctx, size)
    ctx.lineWidth = size * 0.032
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
    const bars = 8
    const step = size / bars
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(0, i * step + step * 0.22, size, step * 0.56)
    }
    enforceTileWrap(ctx, size)
  },

  dots(ctx, size) {
    fill(ctx, size)
    const step = size / 8
    const r = step * 0.28
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    enforceTileWrap(ctx, size)
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
    ctx.lineWidth = size * 0.028
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

const thumbnailCache = new Map<PatternId, string>()

/**
 * Registry of custom uploaded textures as opaque grayscale height-mask canvases
 * (white = raised). Keyed by custom pattern id. The pattern system reads these
 * the same way it reads built-in canvases, so custom textures drive geometry
 * height only — never material color.
 */
const customCanvasRegistry = new Map<string, HTMLCanvasElement>()

function isBuiltinPattern(patternId: PatternId): patternId is BuiltinPatternId {
  return patternId in PATTERN_DRAWERS
}

export function isCustomPattern(patternId: PatternId): boolean {
  return customCanvasRegistry.has(patternId)
}

export function registerCustomPatternCanvas(id: string, canvas: HTMLCanvasElement): void {
  customCanvasRegistry.set(id, canvas)
}

export function unregisterCustomPatternCanvas(id: string): void {
  customCanvasRegistry.delete(id)
}

/**
 * Convert an uploaded image into an opaque grayscale height-mask canvas.
 * Luminance drives height; transparent pixels become flat (black). An optional
 * invert flips high/low so users can use either black-on-white or white-on-black art.
 */
export function imageToHeightMaskCanvas(
  image: HTMLImageElement,
  options: { size?: number; invert?: boolean } = {},
): HTMLCanvasElement {
  const size = options.size ?? 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(image, 0, 0, size, size)

  const imageData = ctx.getImageData(0, 0, size, size)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    let value = lum * a
    if (options.invert) value = 255 - value
    data[i] = data[i + 1] = data[i + 2] = value
    data[i + 3] = 255
  }
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export function getPatternDefinition(patternId: PatternId): PatternDefinition {
  const builtin = PATTERN_DEFINITIONS.find((d) => d.id === patternId)
  if (builtin) return builtin
  return { id: patternId, ...CUSTOM_PATTERN_DEFINITION }
}

export function getPatternCanvas(patternId: PatternId, size = 256): HTMLCanvasElement {
  const custom = customCanvasRegistry.get(patternId)
  if (custom) return custom

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  const drawer = isBuiltinPattern(patternId) ? PATTERN_DRAWERS[patternId] : PATTERN_DRAWERS.grid
  drawer(ctx, size)
  return canvas
}

/**
 * Rasterize a pattern (built-in or custom) to ImageData for height-mask sampling.
 * Only used for patterns without a smooth procedural evaluator (custom uploads
 * and `cracks`); procedural built-ins are sampled analytically instead.
 */
export function getPatternImageData(patternId: PatternId, size = 512): ImageData | null {
  const canvas = getPatternCanvas(patternId, size)
  const ctx = canvas.getContext('2d')
  return ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null
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
  thumbnailCache.clear()
}
