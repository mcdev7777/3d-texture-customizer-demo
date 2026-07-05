import { useEffect, useRef } from 'react'
import type { Mesh, Object3D } from 'three'
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

interface PreviewTarget {
  mesh: Mesh
  modelRoot: Object3D
}

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
  const lastTargetRef = useRef<PreviewTarget | null>(null)

  useEffect(() => {
    if (!modelObject || !selectedSurface || !settings?.patternId) {
      return
    }

    const mesh = findMeshByUuid(modelObject, selectedSurface.meshUuid)
    if (!mesh) {
      useBakeStore.getState().setPreviewActive(false)
      useBakeStore.setState({
        status: 'error',
        error: 'Could not find the selected mesh in the loaded model.',
      })
      return
    }

    const previousTarget = lastTargetRef.current
    if (
      previousTarget &&
      (previousTarget.mesh !== mesh || previousTarget.modelRoot !== modelObject)
    ) {
      try {
        removePreviewPattern(previousTarget.mesh, previousTarget.modelRoot)
      } catch {
        // Model may already be disposed during unload.
      }
    }

    lastTargetRef.current = { mesh, modelRoot: modelObject }

    try {
      if (previewActive) {
        applyPreviewPattern(mesh, modelObject, selectedSurface, settings)
      } else if (isCommitted) {
        const updated = updateCommittedRegionSettings(
          mesh,
          modelObject,
          selectedSurface.surfaceId,
          settings,
        )
        if (!updated) {
          useBakeStore.setState({
            status: 'error',
            error: 'Could not update applied texture — try applying again.',
          })
        }
      } else {
        removePreviewPattern(mesh, modelObject)
      }
    } catch (err) {
      lastTargetRef.current = null
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

  useEffect(() => {
    return () => {
      const target = lastTargetRef.current
      if (!target) return
      try {
        removePreviewPattern(target.mesh, target.modelRoot)
      } catch {
        // Model may already be disposed during unload.
      }
      lastTargetRef.current = null
    }
  }, [modelObject])

  return null
}
