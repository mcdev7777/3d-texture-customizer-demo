import type { PatternId, PatternMode, SurfacePatternSettings } from './pattern'

export type EmbossMode = PatternMode

export type BakeStatus =
  | 'idle'
  | 'preview'
  | 'bake-pending'
  | 'baking'
  | 'baked'
  | 'export-ready'
  | 'preparing'
  | 'exporting'
  | 'complete'
  | 'error'

export type ExportFormat = 'stl' | 'obj' | 'glb'

/** Serializable placement used for baking, export, and variant storage. */
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
  plane: {
    center: [number, number, number]
    normal: [number, number, number]
    width: number
    height: number
    quaternion: [number, number, number, number]
  }
}

export interface GeometryBakeOptions {
  selectedSurfaceId?: string
  placements: PatternPlacement[]
  segmentCount?: number
  maxDepth?: number
  includeTextures?: boolean
}

export interface GeometryBakeResult {
  object: import('three').Object3D
  bakedMeshes: import('three').Mesh[]
  warnings: string[]
}

export function placementFromStoreEntry(
  surfaceId: string,
  label: string,
  settings: SurfacePatternSettings,
  plane: PatternPlacement['plane'],
): PatternPlacement | null {
  if (!settings.patternId) return null
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
    plane,
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
