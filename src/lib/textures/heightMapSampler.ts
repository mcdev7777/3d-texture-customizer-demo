export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function frac(x: number): number {
  return x - Math.floor(x)
}

export function sampleImageHeight(
  imageData: ImageData,
  u: number,
  v: number,
  wrap = true,
): number {
  const { data, width, height } = imageData
  const fx = (wrap ? frac(u) : clamp01(u)) * width - 0.5
  const fy = (wrap ? frac(1 - v) : clamp01(1 - v)) * height - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0

  const lum = (px: number, py: number): number => {
    const wx = wrap ? ((px % width) + width) % width : Math.min(Math.max(px, 0), width - 1)
    const wy = wrap ? ((py % height) + height) % height : Math.min(Math.max(py, 0), height - 1)
    const idx = (wy * width + wx) * 4
    const a = data[idx + 3]! / 255
    return (
      (0.2126 * data[idx]! + 0.7152 * data[idx + 1]! + 0.0722 * data[idx + 2]!) / 255 * a
    )
  }

  const top = lum(x0, y0) * (1 - tx) + lum(x0 + 1, y0) * tx
  const bottom = lum(x0, y0 + 1) * (1 - tx) + lum(x0 + 1, y0 + 1) * tx
  return top * (1 - ty) + bottom * ty
}

export function shapeHeightSample(
  raw: number,
  options: { invert?: boolean; smoothing?: number },
): number {
  let h = clamp01(raw)
  if (options.invert) h = 1 - h
  const sm = clamp01(options.smoothing ?? 0)
  if (sm > 0) {
    const softened = h * h * (3 - 2 * h)
    h = h * (1 - sm) + softened * sm
  }
  return h
}
