import type { PatternId, PatternMode, SurfacePlaneData, SurfacePatternSettings } from './pattern'

export type EmbossMode = PatternMode

export type BakeStatus = 'idle' | 'applying' | 'exporting' | 'error'

export type ExportFormat = 'stl' | 'obj' | 'glb'

/** Flattened placement (settings + planar islands) used for baking and export. */
export interface PatternPlacement {
  surfaceId: string
  label: string
  patternId: PatternId
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  depth: number
  mode: EmbossMode
  opacity: number
  planes: SurfacePlaneData[]
}

export function placementFromStoreEntry(
  surfaceId: string,
  label: string,
  settings: SurfacePatternSettings,
  planes: SurfacePlaneData[],
): PatternPlacement | null {
  if (!settings.patternId || planes.length === 0) return null
  return {
    surfaceId,
    label,
    patternId: settings.patternId,
    offsetX: settings.offsetX,
    offsetY: settings.offsetY,
    scale: settings.scale,
    rotation: settings.rotation,
    depth: settings.depth,
    mode: settings.mode,
    opacity: settings.opacity,
    planes,
  }
}

export function settingsFromPlacement(placement: PatternPlacement): SurfacePatternSettings {
  return {
    patternId: placement.patternId,
    mode: placement.mode,
    scale: placement.scale,
    rotation: placement.rotation,
    offsetX: placement.offsetX,
    offsetY: placement.offsetY,
    depth: placement.depth,
    opacity: placement.opacity,
  }
}
