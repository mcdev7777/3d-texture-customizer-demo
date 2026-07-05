import { useEffect, useRef } from 'react'
import type { Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import {
  applyPreviewPattern,
  removePreviewPattern,
  updateCommittedRegionSettings,
} from '../../lib/materials/patternMaterialApply'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'

/** Live bump preview + committed region depth updates. */
export function TexturePreviewOverlay() {
  const modelObject = useAppStore((s) => s.loadedModel?.object)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const selectedSurfaceId = selectedSurface?.surfaceId
  const placement = usePatternStore((s) =>
    selectedSurfaceId ? s.placements[selectedSurfaceId] : undefined,
  )
  const previewActive = useBakeStore((s) => s.previewActive)
  const isCommitted = useBakeStore((s) =>
    selectedSurfaceId ? s.committedSurfaceIds.includes(selectedSurfaceId) : false,
  )

  const settings = placement?.settings
  const lastMeshRef = useRef<Mesh | null>(null)

  useEffect(() => {
    if (!modelObject || !selectedSurface || !settings?.patternId) {
      if (lastMeshRef.current && modelObject) {
        removePreviewPattern(lastMeshRef.current, modelObject)
        lastMeshRef.current = null
      }
      return
    }

    const mesh = findMeshByUuid(modelObject, selectedSurface.meshUuid)
    if (!mesh) return

    lastMeshRef.current = mesh

    try {
      if (previewActive) {
        applyPreviewPattern(mesh, modelObject, selectedSurface, settings)
      } else if (isCommitted) {
        updateCommittedRegionSettings(mesh, modelObject, selectedSurface.surfaceId, settings)
      } else {
        removePreviewPattern(mesh, modelObject)
      }
    } catch (err) {
      removePreviewPattern(mesh, modelObject)
      lastMeshRef.current = null
      const message = err instanceof Error ? err.message : 'Preview failed.'
      useBakeStore.getState().setPreviewActive(false)
      useBakeStore.setState({ status: 'error', error: message })
    }
  }, [
    previewActive,
    isCommitted,
    selectedSurface,
    modelObject,
    settings?.patternId,
    settings?.mode,
    settings?.scale,
    settings?.rotation,
    settings?.offsetX,
    settings?.offsetY,
    settings?.depth,
    settings?.smoothing,
    settings?.invert,
    settings?.opacity,
  ])

  return null
}
