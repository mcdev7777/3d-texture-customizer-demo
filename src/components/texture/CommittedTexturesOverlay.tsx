import { useEffect } from 'react'
import { useBakeStore } from '../../store/useBakeStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

/**
 * Renders all committed (applied) relief patches. This group persists across
 * previews and selection changes — previewing another surface never hides or
 * removes committed geometry. While the currently selected surface is being
 * previewed, its committed patch is hidden so the live preview shows instead of
 * overlapping it.
 */
export function CommittedTexturesOverlay() {
  const committedGroup = useBakeStore((s) => s.committedGroup)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)
  const previewActive = useBakeStore((s) => s.previewActive)
  const selectedSurfaceId = useSurfaceSelectionStore((s) => s.selectedSurface?.surfaceId)
  const selectedHasPattern = usePatternStore((s) =>
    selectedSurfaceId ? !!s.placements[selectedSurfaceId]?.settings.patternId : false,
  )

  // Hide a committed patch only while its surface is being actively previewed, so the
  // live preview replaces it instead of overlapping. All other committed patches stay visible.
  const hiddenSurfaceId = previewActive && selectedHasPattern ? selectedSurfaceId : undefined

  useEffect(() => {
    for (const child of committedGroup.children) {
      const surfaceId = child.userData.surfaceId as string | undefined
      child.visible = surfaceId !== hiddenSurfaceId
    }
  }, [committedGroup, committedSurfaceIds, hiddenSurfaceId])

  return <primitive object={committedGroup} dispose={null} />
}
