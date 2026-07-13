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
const BG = '#ffffff'

type DrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

/** Hex/honeycomb tiles use a rectangular period that matches flat-top honeycomb geometry. */
function getHexTileDimensions(size: number): { width: number; height: number } {
  const width = size
  const height = Math.round((size * Math.sqrt(3)) / 4)
  return { width, height: Math.max(1, height) }
}

function fill(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
}

/** Default metadata for an uploaded custom texture (no built-in entry exists). */
const CUSTOM_PATTERN_DEFINITION: Omit<PatternDefinition, 'id'> = {
  label: 'Custom',
  category: 'custom',
  defaultScale: 1,
  defaultDepth: 1.4,
  tileable: true,
}

/** Flat-top hex grid metrics sized so `cols` columns span the tile width exactly. */
function hexGridMetrics(width: number, cols: number) {
  const r = width / (cols * Math.sqrt(3))
  return { r, w: Math.sqrt(3) * r, h: 1.5 * r, cols }
}

/** Draw a flat-top hex grid that tiles seamlessly left/right and top/bottom. */
function drawSeamlessHexGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cols: number,
  lineWidthRatio: number,
  radiusScale = 1,
): void {
  const { r, w, h } = hexGridMetrics(width, cols)
  ctx.lineWidth = width * lineWidthRatio
  const rowCount = Math.ceil(height / h) + 2
  for (let row = -1; row < rowCount; row++) {
    const cy = row * h
    const colOffset = row % 2 ? w / 2 : 0
    for (let col = -1; col <= cols; col++) {
      const cx = col * w + colOffset
      hexPath(ctx, cx, cy, r * radiusScale)
      ctx.stroke()
    }
  }
  enforceTileWrap(ctx, width, height)
}

/** Copy inner edge pixels to the outer border so RepeatWrapping has no seam. */
function enforceTileWrap(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const d = imageData.data
  const rowBytes = width * 4

  for (let y = 0; y < height; y++) {
    const row = y * rowBytes
    for (let c = 0; c < 4; c++) {
      d[row + c] = d[row + 4 + c]
      d[row + (width - 1) * 4 + c] = d[row + (width - 2) * 4 + c]
    }
  }

  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 4; c++) {
      const top = x * 4 + c
      const bottom = (height - 1) * rowBytes + x * 4 + c
      d[top] = d[rowBytes + x * 4 + c]
      d[bottom] = d[(height - 2) * rowBytes + x * 4 + c]
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

/** UV aspect correction for patterns whose vertical repeat period differs from horizontal. */
export function getPatternTileAspect(patternId: PatternId): { u: number; v: number } {
  if (patternId === 'hex' || patternId === 'honeycomb') {
    const { width, height } = getHexTileDimensions(512)
    return { u: 1, v: width / height }
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
  hex(ctx, width, height) {
    fill(ctx, width, height)
    drawSeamlessHexGrid(ctx, width, height, 4, 0.028, 0.98)
  },

  grid(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.028
    const step = width / 8
    for (let x = 0; x <= width; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y <= height; y += step) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    enforceTileWrap(ctx, width, height)
  },

  diamond(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.028
    const step = width / (4 * Math.sqrt(2))
    const extent = width * Math.sqrt(2)
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.rotate(Math.PI / 4)
    for (let x = -extent; x <= extent; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, -extent)
      ctx.lineTo(x, extent)
      ctx.stroke()
    }
    for (let y = -extent; y <= extent; y += step) {
      ctx.beginPath()
      ctx.moveTo(-extent, y)
      ctx.lineTo(extent, y)
      ctx.stroke()
    }
    ctx.restore()
    enforceTileWrap(ctx, width, height)
  },

  honeycomb(ctx, width, height) {
    fill(ctx, width, height)
    drawSeamlessHexGrid(ctx, width, height, 4, 0.032, 0.96)
  },

  scales(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.032
    const cols = 6
    const step = width / cols
    const r = step * 0.62
    for (let row = -1; row * (step * 0.6) < height + step; row++) {
      const offset = row % 2 ? step / 2 : 0
      const cy = row * step * 0.6
      for (let col = -1; col * step < width + step; col++) {
        const cx = col * step + offset
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI)
        ctx.stroke()
      }
    }
  },

  ribbed(ctx, width, height) {
    fill(ctx, width, height)
    const bars = 8
    const step = height / bars
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(0, i * step + step * 0.22, width, step * 0.56)
    }
    enforceTileWrap(ctx, width, height)
  },

  dots(ctx, width, height) {
    fill(ctx, width, height)
    const step = width / 8
    const r = step * 0.28
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    enforceTileWrap(ctx, width, height)
  },

  waves(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.03
    const rows = 6
    const amp = height * 0.06
    const freq = (Math.PI * 2 * 2) / width
    for (let row = 0; row <= rows; row++) {
      const yBase = (row / rows) * height
      ctx.beginPath()
      for (let x = 0; x <= width; x += 2) {
        const y = yBase + Math.sin(x * freq) * amp
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  },

  zigzag(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.03
    const rows = 6
    const step = width / rows
    const peak = step * 0.5
    for (let row = 0; row <= rows; row++) {
      const yBase = (row / rows) * height
      ctx.beginPath()
      let up = true
      for (let x = 0; x <= width; x += step) {
        const y = yBase + (up ? -peak : peak)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        up = !up
      }
      ctx.stroke()
    }
  },

  brick(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.022
    const rows = 6
    const rowH = height / rows
    const brickW = width / 3
    for (let row = 0; row < rows; row++) {
      const y = row * rowH
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
      const offset = row % 2 ? brickW / 2 : 0
      for (let x = offset; x <= width; x += brickW) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + rowH)
        ctx.stroke()
      }
    }
  },

  crosshatch(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.028
    const step = width / 8
    for (let i = -width; i < width * 2; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + width, height)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i, height)
      ctx.lineTo(i + width, 0)
      ctx.stroke()
    }
    enforceTileWrap(ctx, width, height)
  },

  cracks(ctx, width, height) {
    fill(ctx, width, height)
    ctx.lineWidth = width * 0.02
    const nodes = 9
    const seeds: Array<[number, number]> = []
    let s = 1337
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
    for (let i = 0; i < nodes; i++) {
      seeds.push([rand() * width, rand() * height])
    }
    for (let i = 0; i < seeds.length; i++) {
      const [x0, y0] = seeds[i]
      const branches = 2 + Math.floor(rand() * 2)
      for (let b = 0; b < branches; b++) {
        const target = seeds[(i + 1 + b) % seeds.length]
        const midX = (x0 + target[0]) / 2 + (rand() - 0.5) * width * 0.2
        const midY = (y0 + target[1]) / 2 + (rand() - 0.5) * height * 0.2
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.quadraticCurveTo(midX, midY, target[0], target[1])
        ctx.stroke()
      }
    }
  },
}

/**
 * Soften hard pattern edges so the displacement height-mask transitions as a
 * gradient instead of a binary cliff. Built-in patterns are drawn with pure
 * ink/background, which produces vertical walls in the displaced mesh; a small
 * Gaussian blur turns each edge into a short ramp that the mesh follows as a
 * fillet. Radius scales with canvas size so the softness stays constant in UV
 * space regardless of the rasterization resolution.
 */
function smoothPatternEdges(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  // ~1.4px at the 128 base resolution, scaled to the target canvas.
  const radius = Math.max(0.75, (Math.min(width, height) / 128) * 1.4)

  // Pad by enough that the blur kernel near an edge only reads real (wrapped)
  // pixels, never the canvas void. `blur(r)` has an effective reach of ~3r.
  const pad = Math.max(2, Math.ceil(radius * 3))

  // Build a tiled (wrapped) source so the blur at each edge samples the pattern
  // as it actually repeats. Blurring the bare canvas instead reads the area
  // OUTSIDE it as transparent black, which darkens the border → raised ink →
  // a visible seam frame around every tile (worst at scale < 1 where tiles are
  // dense). Tiling first makes the softened edges continuous across the wrap.
  const padded = document.createElement('canvas')
  padded.width = width + pad * 2
  padded.height = height + pad * 2
  const padCtx = padded.getContext('2d')
  if (!padCtx) return
  const src = ctx.canvas
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      padCtx.drawImage(src, pad + dx * width, pad + dy * height)
    }
  }

  // Blur the tiled buffer, then copy the center region back over the original.
  const blurred = document.createElement('canvas')
  blurred.width = padded.width
  blurred.height = padded.height
  const blurCtx = blurred.getContext('2d')
  if (!blurCtx) return
  blurCtx.filter = `blur(${radius}px)`
  blurCtx.drawImage(padded, 0, 0)

  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(blurred, pad, pad, width, height, 0, 0, width, height)

  // Re-tile the outermost row/col so bilinear RepeatWrapping stays exact.
  enforceTileWrap(ctx, width, height)
}

const thumbnailCache = new Map<PatternId, string>()

/**
 * Registry of custom uploaded textures as opaque grayscale height-mask canvases
 * (white = raised). Keyed by custom pattern id. The pattern system reads these
 * the same way it reads built-in canvases for shader pattern sampling.
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
  const size = options.size ?? 512
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
  smoothPatternEdges(ctx, size, size)
  return canvas
}

export function getPatternDefinition(patternId: PatternId): PatternDefinition {
  const builtin = PATTERN_DEFINITIONS.find((d) => d.id === patternId)
  if (builtin) return builtin
  return { id: patternId, ...CUSTOM_PATTERN_DEFINITION }
}

export function getPatternCanvas(patternId: PatternId, size = 512): HTMLCanvasElement {
  const custom = customCanvasRegistry.get(patternId)
  if (custom) return custom

  const canvas = document.createElement('canvas')
  let width = size
  let height = size
  if (patternId === 'hex' || patternId === 'honeycomb') {
    const dims = getHexTileDimensions(size)
    width = dims.width
    height = dims.height
  }
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  if (isBuiltinPattern(patternId)) {
    // Rasterize the vector drawer once at a fixed 512 base, then resample to
    // the requested size — matching how custom uploads are normalized to a 512
    // height-mask canvas and scaled on draw.
    const BASE_SIZE = 512
    let baseWidth = BASE_SIZE
    let baseHeight = BASE_SIZE
    if (patternId === 'hex' || patternId === 'honeycomb') {
      const baseDims = getHexTileDimensions(BASE_SIZE)
      baseWidth = baseDims.width
      baseHeight = baseDims.height
    }
    const baseCanvas = document.createElement('canvas')
    baseCanvas.width = baseWidth
    baseCanvas.height = baseHeight
    const baseCtx = baseCanvas.getContext('2d')
    if (!baseCtx) throw new Error('Canvas 2D unavailable')
    PATTERN_DRAWERS[patternId](baseCtx, baseWidth, baseHeight)

    ctx.drawImage(baseCanvas, 0, 0, width, height)
    smoothPatternEdges(ctx, width, height)
    return canvas
  }

  // Unknown id (e.g. removed custom texture) — neutral flat mask, not a wrong pattern.
  ctx.fillStyle = '#f5f5f5'
  ctx.fillRect(0, 0, width, height)
  return canvas
}

/**
 * Rasterize a pattern (built-in or custom) to ImageData for height-mask sampling.
 * Export baking samples this texture to match the shader preview.
 */
export function getPatternImageData(patternId: PatternId, size = 512): ImageData | null {
  const canvas = getPatternCanvas(patternId, size)
  const ctx = canvas.getContext('2d')
  return ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null
}

const THUMBNAIL_CACHE_VERSION = 'v4'

export function createPatternThumbnail(patternId: PatternId): string {
  const cacheKey = `${patternId}@${THUMBNAIL_CACHE_VERSION}`
  const cached = thumbnailCache.get(cacheKey)
  if (cached) return cached

  const canvas = getPatternCanvas(patternId, 96)
  const url = canvas.toDataURL('image/png')
  thumbnailCache.set(cacheKey, url)
  return url
}

export function disposePatternTextures(): void {
  thumbnailCache.clear()
}
