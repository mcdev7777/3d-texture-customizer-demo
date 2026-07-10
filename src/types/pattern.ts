export type BuiltinPatternId =
  | 'hex'
  | 'grid'
  | 'diamond'
  | 'honeycomb'
  | 'scales'
  | 'ribbed'
  | 'dots'
  | 'waves'
  | 'zigzag'
  | 'brick'
  | 'crosshatch'
  | 'cracks'

/**
 * A pattern id is either one of the built-in patterns or a custom uploaded
 * texture id (e.g. "custom-1720000000000"). The `(string & {})` keeps literal
 * autocomplete for the built-ins while allowing arbitrary custom ids.
 */
export type PatternId = BuiltinPatternId | (string & {})

export type PatternCategory = 'geometric' | 'organic' | 'lines' | 'surface' | 'custom'

export type PatternMode = 'emboss' | 'engrave'

export interface SurfacePatternSettings {
  patternId: PatternId | null
  mode: PatternMode
  /**
   * Uniform tile-size multiplier. Kept for backward compatibility and as the
   * fallback when a per-axis scale is not set. Prefer reading the effective
   * per-axis scale via {@link patternScaleU} / {@link patternScaleV}.
   */
  scale: number
  /** Per-axis (U / horizontal) tile-size multiplier. Falls back to `scale`. */
  scaleX?: number
  /** Per-axis (V / vertical) tile-size multiplier. Falls back to `scale`. */
  scaleY?: number
  rotation: number
  offsetX: number
  offsetY: number
  /** Depth (0–2). 0 = flat; higher = stronger relief and shadow. */
  depth: number
  opacity: number
  /** 0–1 edge softening for height sampling. */
  smoothing: number
  invert: boolean
  symmetric: boolean
}

/** Effective U-axis (horizontal) tile-size multiplier, falling back to `scale`. */
export function patternScaleU(s: SurfacePatternSettings): number {
  return s.scaleX ?? s.scale
}

/** Effective V-axis (vertical) tile-size multiplier, falling back to `scale`. */
export function patternScaleV(s: SurfacePatternSettings): number {
  return s.scaleY ?? s.scale
}

export const DEFAULT_PATTERN_SETTINGS: SurfacePatternSettings = {
  patternId: null,
  mode: 'emboss',
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  depth: 1,
  opacity: 1,
  smoothing: 0,
  invert: false,
  symmetric: false,
}

export const DEPTH_MIN = 0
export const DEPTH_MAX = 2
export const DEPTH_DEFAULT = 1
export const SCALE_MIN = 0.25
export const SCALE_MAX = 5
export const ROTATION_MIN = 0
export const ROTATION_MAX = 360

export interface SurfacePatternPlacement {
  surfaceId: string
  label: string
  settings: SurfacePatternSettings
}
