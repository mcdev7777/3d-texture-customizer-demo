import { useEffect, useMemo } from 'react'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import { createPatchMesh } from '../../lib/geometry/bakePatternGeometry'
import { disposeObject } from '../../lib/three/disposeObject'
import { placementFromStoreEntry } from '../../types/bake'

const PREVIEW_SEGMENTS = 48

/**
 * Live preview of the applied texture rendered as real displaced geometry
 * (a temporary helper patch). Emboss raises outward, engrave recesses inward.
 */
export function TexturePreviewOverlay() {
  const selectedSurfaceId = useSurfaceSelectionStore((s) => s.selectedSurface?.surfaceId)
  const placement = usePatternStore((s) =>
    selectedSurfaceId ? s.placements[selectedSurfaceId] : undefined,
  )
  const previewActive = useBakeStore((s) => s.previewActive)
  const bakedSurfaceIds = useBakeStore((s) => s.bakedSurfaceIds)

  const settings = placement?.settings
  const plane = placement?.plane

  const mesh = useMemo(() => {
    if (!previewActive || !selectedSurfaceId || !settings?.patternId || !plane) return null
    if (bakedSurfaceIds.includes(selectedSurfaceId)) return null

    const patternPlacement = placementFromStoreEntry(
      selectedSurfaceId,
      placement?.label ?? 'surface',
      settings,
      plane,
    )
    if (!patternPlacement) return null

    try {
      return createPatchMesh(patternPlacement, {
        segmentCount: PREVIEW_SEGMENTS,
        includeTextures: true,
        role: 'preview',
      }).mesh
    } catch {
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    previewActive,
    selectedSurfaceId,
    settings?.patternId,
    settings?.mode,
    settings?.scale,
    settings?.rotation,
    settings?.offsetX,
    settings?.offsetY,
    settings?.depth,
    settings?.opacity,
    plane,
    bakedSurfaceIds,
  ])

  useEffect(() => {
    return () => {
      if (mesh) disposeObject(mesh)
    }
  }, [mesh])

  if (!mesh) return null

  return <primitive object={mesh} dispose={null} />
}
