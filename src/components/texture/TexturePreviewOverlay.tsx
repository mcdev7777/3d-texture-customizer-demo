import { useEffect, useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import { createPatchGroup } from '../../lib/geometry/bakePatternGeometry'
import { disposeObject } from '../../lib/three/disposeObject'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'
import { placementFromStoreEntry } from '../../types/bake'

const PREVIEW_SEGMENTS = 56

/**
 * Live preview of the selected surface/part texture rendered as real displaced
 * geometry (a temporary helper group with one patch per planar island). Emboss
 * raises outward, engrave reads as recessed. The preview only ever represents the
 * current selection — it is added and removed on its own and never touches
 * committed geometry.
 */
export function TexturePreviewOverlay() {
  const modelObject = useAppStore((s) => s.loadedModel?.object)
  const selectedSurfaceId = useSurfaceSelectionStore((s) => s.selectedSurface?.surfaceId)
  const meshUuid = useSurfaceSelectionStore((s) => s.selectedSurface?.meshUuid)
  const placement = usePatternStore((s) =>
    selectedSurfaceId ? s.placements[selectedSurfaceId] : undefined,
  )
  const previewActive = useBakeStore((s) => s.previewActive)

  const settings = placement?.settings
  const planes = placement?.planes

  const group = useMemo(() => {
    if (!previewActive || !selectedSurfaceId || !settings?.patternId || !planes?.length) {
      return null
    }

    const patternPlacement = placementFromStoreEntry(
      selectedSurfaceId,
      placement?.label ?? 'surface',
      settings,
      planes,
    )
    if (!patternPlacement) return null

    const sourceMesh =
      modelObject && meshUuid ? findMeshByUuid(modelObject, meshUuid) : null

    try {
      return createPatchGroup(patternPlacement, {
        segmentCount: PREVIEW_SEGMENTS,
        role: 'preview',
        sourceMaterial: sourceMesh?.material ?? null,
      }).group
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewActive,
    selectedSurfaceId,
    meshUuid,
    modelObject,
    settings?.patternId,
    settings?.mode,
    settings?.scale,
    settings?.rotation,
    settings?.offsetX,
    settings?.offsetY,
    settings?.depth,
    settings?.opacity,
    planes,
  ])

  useEffect(() => {
    return () => {
      if (group) disposeObject(group)
    }
  }, [group])

  if (!group) return null

  return <primitive object={group} dispose={null} />
}
