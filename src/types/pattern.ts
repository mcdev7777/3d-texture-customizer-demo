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
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  /** Depth level (0.1–3.0). Controls bump emphasis on pattern-black regions. */
  depth: number
  opacity: number
}

export const DEFAULT_PATTERN_SETTINGS: SurfacePatternSettings = {
  patternId: null,
  mode: 'emboss',
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  depth: 1,
  opacity: 1,
}

export const DEPTH_MIN = 0.1
export const DEPTH_MAX = 3
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
