export type PatternId = 'diagonal' | 'grid' | 'dots' | 'waves' | 'chevron' | 'mark'

export type PatternMode = 'emboss' | 'engrave'

export interface SurfacePatternSettings {
  patternId: PatternId | null
  mode: PatternMode
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
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
  depth: 0.04,
  opacity: 1,
}

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
