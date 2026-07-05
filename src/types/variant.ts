import type { SurfacePatternPlacement } from './pattern'

/** Placement stored in a variation — includes stable mesh refs for reload. */
export interface VariationPlacement extends SurfacePatternPlacement {
  meshPath: string
  meshOrdinal: number
}

/** Saved texture configuration for the current model (browser localStorage). */
export interface ModelVariation {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sourceModelName?: string
  placements: VariationPlacement[]
  committedSurfaceIds: string[]
  selectedSurfaceId?: string
}
