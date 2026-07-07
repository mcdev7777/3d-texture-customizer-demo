import type { SelectedSurface } from '../../types/surfaceSelection'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

/** Surfaces currently targeted for pattern library, preview, and apply. */
export function getPatternTargetSurfaces(): SelectedSurface[] {
  const { selectedSurfaces, selectedSurface } = useSurfaceSelectionStore.getState()
  if (selectedSurfaces.length > 0) return selectedSurfaces
  return selectedSurface ? [selectedSurface] : []
}

export function getPatternTargetSurfaceIds(): string[] {
  return getPatternTargetSurfaces().map((surface) => surface.surfaceId)
}
