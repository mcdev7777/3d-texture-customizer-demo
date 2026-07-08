import { useEffect, useMemo, useRef } from 'react'
import type { Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import {
  computeSharedWorldBounds,
  removePreviewPattern,
  syncMeshPreviewPatterns,
  updateCommittedRegionSettings,
  type MeshPreviewTarget,
} from '../../lib/materials/patternMaterialApply'
import { findMeshByUuid } from '../../lib/surface/restoreSurfaceFromId'

function placementSignature(
  surfaceId: string,
  settings: {
    patternId: string | null
    mode: string
    scale: number
    rotation: number
    offsetX: number
    offsetY: number
    depth: number
    smoothing: number
    invert: boolean
    opacity: number
  } | undefined,
): string {
  if (!settings?.patternId) return `${surfaceId}:`
  return [
    surfaceId,
    settings.patternId,
    settings.mode,
    settings.scale,
    settings.rotation,
    settings.offsetX,
    settings.offsetY,
    settings.depth,
    settings.smoothing,
    settings.invert,
    settings.opacity,
  ].join(':')
}

/** Live bump preview + committed region updates for all selected surfaces. */
export function TexturePreviewOverlay() {
  const modelObject = useAppStore((s) => s.loadedModel?.object)
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)
  const activeSurfaceId = useSurfaceSelectionStore((s) => s.activeSurfaceId)
  const placements = usePatternStore((s) => s.placements)
  const patternCoherence = usePatternStore((s) => s.patternCoherence)
  const previewActive = useBakeStore((s) => s.previewActive)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)

  const previewMeshesRef = useRef<Set<Mesh>>(new Set())

  const placementKey = useMemo(
    () =>
      selectedSurfaces
        .map((surface) => placementSignature(surface.surfaceId, placements[surface.surfaceId]?.settings))
        .join('|'),
    [selectedSurfaces, placements],
  )

  const selectionKey = useMemo(
    () =>
      selectedSurfaces
        .map((surface) => `${surface.surfaceId}:${surface.triangleCount}`)
        .join('|'),
    [selectedSurfaces],
  )

  useEffect(() => {
    if (!modelObject) return

    const patternStore = usePatternStore.getState()
    if (previewActive && selectedSurfaces.length > 1 && activeSurfaceId) {
      const source = patternStore.placements[activeSurfaceId]
      const needsSync =
        !!source?.settings.patternId &&
        selectedSurfaces.some(
          (surface) =>
            surface.surfaceId !== activeSurfaceId &&
            !patternStore.placements[surface.surfaceId]?.settings.patternId,
        )
      if (needsSync) {
        patternStore.syncActivePlacementToTargets(selectedSurfaces, activeSurfaceId)
      }
    }

    const currentPlacements = usePatternStore.getState().placements
    const previewsByMesh = new Map<string, { mesh: Mesh; items: MeshPreviewTarget[] }>()
    const touchedMeshes = new Set<Mesh>()

    for (const surface of selectedSurfaces) {
      const settings = currentPlacements[surface.surfaceId]?.settings
      if (!settings?.patternId) continue

      const mesh = findMeshByUuid(modelObject, surface.meshUuid)
      if (!mesh) {
        useBakeStore.getState().setPreviewActive(false)
        useBakeStore.setState({
          status: 'error',
          error: 'Could not find the selected mesh in the loaded model.',
        })
        return
      }

      touchedMeshes.add(mesh)
      const bucket = previewsByMesh.get(mesh.uuid) ?? { mesh, items: [] }
      bucket.items.push({ surface, settings })
      previewsByMesh.set(mesh.uuid, bucket)
    }

    try {
      if (previewActive) {
        const coherence = patternStore.patternCoherence
        const mergeActive = coherence === 'merged' && selectedSurfaces.length > 1
        // Mirrors useBakeStore.applyTexture's merged-commit branch: only
        // override each mesh's own bounds with one shared world-space frame
        // when the merge spans more than one mesh — a single-mesh merge's
        // own region bounds already cover its full triangle union.
        const sharedBounds =
          mergeActive && previewsByMesh.size > 1
            ? computeSharedWorldBounds(modelObject, selectedSurfaces)
            : undefined

        for (const { mesh, items } of previewsByMesh.values()) {
          // A mesh that contributes only ONE surface to a merged group still
          // needs the merge path (cubic mapping + shared bounds) — otherwise
          // it falls back to its own independent tangent-plane projection,
          // which is exactly the "disconnected surfaces don't read as one
          // imagined surface" bug: two mesh bodies on opposite sides of a
          // gap each contribute a single surface, so a `items.length > 1`
          // check here never merges them.
          if (mergeActive) {
            const primarySurfaceId =
              items.find((item) => item.surface.surfaceId === activeSurfaceId)?.surface.surfaceId ??
              items[0]!.surface.surfaceId
            syncMeshPreviewPatterns(mesh, modelObject, items, { primarySurfaceId, sharedBoundsWorld: sharedBounds })
          } else {
            syncMeshPreviewPatterns(mesh, modelObject, items)
          }
        }
      } else {
        for (const surface of selectedSurfaces) {
          const settings = currentPlacements[surface.surfaceId]?.settings
          if (!settings?.patternId) continue
          if (!committedSurfaceIds.includes(surface.surfaceId)) continue

          const mesh = findMeshByUuid(modelObject, surface.meshUuid)
          if (!mesh) continue

          const updated = updateCommittedRegionSettings(
            mesh,
            modelObject,
            surface.surfaceId,
            settings,
          )
          if (!updated) {
            useBakeStore.setState({
              status: 'error',
              error: 'Could not update applied texture — try applying again.',
            })
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Preview failed.'
      useBakeStore.getState().setPreviewActive(false)
      useBakeStore.setState({ status: 'error', error: message })
    }

    for (const mesh of previewMeshesRef.current) {
      if (!touchedMeshes.has(mesh)) {
        try {
          removePreviewPattern(mesh, modelObject)
        } catch {
          // Model may already be disposed during unload.
        }
      }
    }

    if (!previewActive) {
      for (const mesh of touchedMeshes) {
        const hasCommittedOnMesh = selectedSurfaces.some(
          (surface) =>
            surface.meshUuid === mesh.uuid &&
            committedSurfaceIds.includes(surface.surfaceId) &&
            currentPlacements[surface.surfaceId]?.settings.patternId,
        )
        if (!hasCommittedOnMesh) {
          try {
            removePreviewPattern(mesh, modelObject)
          } catch {
            // Model may already be disposed during unload.
          }
        }
      }
    }

    previewMeshesRef.current = touchedMeshes
  }, [
    previewActive,
    committedSurfaceIds,
    selectionKey,
    activeSurfaceId,
    modelObject,
    placementKey,
    patternCoherence,
  ])

  useEffect(() => {
    return () => {
      if (!modelObject) return
      for (const mesh of previewMeshesRef.current) {
        try {
          removePreviewPattern(mesh, modelObject)
        } catch {
          // Model may already be disposed during unload.
        }
      }
      previewMeshesRef.current.clear()
    }
  }, [modelObject])

  return null
}
