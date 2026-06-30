export type PatternId =
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

export type PatternCategory = 'geometric' | 'organic' | 'lines' | 'surface'

export type PatternMode = 'emboss' | 'engrave'

export interface SurfacePatternSettings {
  patternId: PatternId | null
  mode: PatternMode
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  /** Depth level (0.1–3.0). Converted to world displacement when baking. */
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

export interface SurfacePlaneData {
  center: [number, number, number]
  normal: [number, number, number]
  width: number
  height: number
  quaternion: [number, number, number, number]
}

export interface SurfacePatternPlacement {
  surfaceId: string
  label: string
  settings: SurfacePatternSettings
  plane: SurfacePlaneData
}
