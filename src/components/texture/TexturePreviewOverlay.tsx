import { useEffect, useRef } from 'react'
import type { Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import {
  applyPreviewPattern,
  removePreviewPattern,
} from '../../lib/materials/patternMaterialApply'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'

/**
 * Headless component that previews the pattern as a material replacement on
 * the selected mesh — white pattern areas keep the surface base color, black
 * areas use a darker emphasis tint with bump shading (no geometry extrusion).
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
        removePreviewPattern(lastMeshRef.current)
        lastMeshRef.current = null
      }
      return
    }

    const mesh = findMeshByUuid(modelObject, selectedSurface.meshUuid)
    if (!mesh) return

    lastMeshRef.current = mesh

    try {
      applyPreviewPattern(mesh, selectedSurface, settings)
    } catch {
      removePreviewPattern(mesh)
      lastMeshRef.current = null
    }

    return () => {
      if (lastMeshRef.current) {
        removePreviewPattern(lastMeshRef.current)
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
