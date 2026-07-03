import { useEffect, useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import { buildReliefForSelection } from '../../lib/geometry/reliefPatch'
import { disposeObject } from '../../lib/three/disposeObject'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'

/**
 * Live preview of the selected surface/part texture rendered as real displaced
 * geometry. Surface selections build one island; part selections build one relief
 * patch per major face so nothing floats or explodes. Emboss raises outward,
 * engrave reads as recessed. The preview only ever represents the current
 * selection — it is added/removed on its own and never touches committed geometry.
 */
export function TexturePreviewOverlay() {
  const modelObject = useAppStore((s) => s.loadedModel?.object)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const selectedSurfaceId = selectedSurface?.surfaceId
  const placement = usePatternStore((s) =>
    selectedSurfaceId ? s.placements[selectedSurfaceId] : undefined,
  )
  const previewActive = useBakeStore((s) => s.previewActive)

  const settings = placement?.settings

  const group = useMemo(() => {
    if (!previewActive || !selectedSurface || !settings?.patternId) {
      return null
    }

    const sourceMesh =
      modelObject && selectedSurface.meshUuid
        ? findMeshByUuid(modelObject, selectedSurface.meshUuid)
        : null

    try {
      return buildReliefForSelection(selectedSurface, settings, {
        role: 'preview',
        sourceMaterial: sourceMesh?.material ?? null,
      }).group
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewActive,
    selectedSurface,
    modelObject,
    settings?.patternId,
    settings?.mode,
    settings?.scale,
    settings?.rotation,
    settings?.offsetX,
    settings?.offsetY,
    settings?.depth,
    settings?.opacity,
  ])

  useEffect(() => {
    return () => {
      if (group) disposeObject(group)
    }
  }, [group])

  if (!group) return null

  return <primitive object={group} dispose={null} />
}
