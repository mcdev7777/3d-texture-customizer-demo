import { useEffect, useRef } from 'react'
import type { Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import {
  applyPreviewGeometry,
  removePreviewGeometry,
} from '../../lib/geometry/bakeInPlace'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'

/**
 * Headless component that manages the live preview by temporarily swapping
 * the selected mesh's geometry with a displaced clone. No overlay mesh is
 * created — the original mesh is modified in-place and restored when the
 * preview is deactivated or settings change.
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
  const lastMeshRef = useRef<Mesh | null>(null)

  useEffect(() => {
    if (!modelObject || !selectedSurface || !settings?.patternId || !previewActive) {
      if (lastMeshRef.current) {
        removePreviewGeometry(lastMeshRef.current)
        lastMeshRef.current = null
      }
      return
    }

    const mesh = findMeshByUuid(modelObject, selectedSurface.meshUuid)
    if (!mesh) return

    lastMeshRef.current = mesh

    try {
      applyPreviewGeometry(mesh, selectedSurface, settings)
    } catch {
      removePreviewGeometry(mesh)
      lastMeshRef.current = null
    }

    return () => {
      if (lastMeshRef.current) {
        removePreviewGeometry(lastMeshRef.current)
        lastMeshRef.current = null
      }
    }
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

  return null
}
