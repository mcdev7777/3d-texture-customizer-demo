import { create } from 'zustand'
import type { BakeStatus, ExportFormat, ExportQuality } from '../types/bake'
import { DEFAULT_EXPORT_QUALITY } from '../types/bake'
import type { ExportProgressState } from '../lib/export/exportProgress'
import {
  commitMergedPatternMaterial,
  commitPatternMaterial,
  computeSharedWorldBounds,
  resetAllPatterns,
  uncommitSurfacePattern,
} from '../lib/materials/patternMaterialApply'
import { exportModifiedModel } from '../lib/export/exportModifiedModel'
import { warmupPipelineWorker } from '../lib/mesh-engine/adapters/runMeshPipeline'
import { findMeshByUuid } from '../lib/surface/restoreSurfaceFromId'
import { getPatternTargetSurfaces } from '../lib/pattern/selectionTargets'
import { useAppStore } from './useAppStore'
import { usePatternStore } from './usePatternStore'
import { useSurfaceSelectionStore } from './useSurfaceSelectionStore'

interface BakeState {
  status: BakeStatus
  committedSurfaceIds: string[]
  warnings: string[]
  error: string | null
  previewActive: boolean
  exportQuality: ExportQuality
  /** True while a background export job is running (does not block other UI). */
  exportActive: boolean
  exportProgress: ExportProgressState | null
  /**
   * Shows applied (committed) patterns as real extruded/embossed 3D geometry
   * instead of the flat 2D bump-shaded preview. Those surfaces become
   * non-selectable while this is on — only original, unpatterned surfaces
   * can still be picked. Actual baking is driven by Pattern3DPreviewOverlay.
   */
  show3DPreview: boolean
  /** True while the 3D preview overlay is (re)baking geometry in the background. */
  show3DPreviewBusy: boolean

  setPreviewActive: (active: boolean) => void
  setExportQuality: (quality: ExportQuality) => void
  setShow3DPreview: (show: boolean) => void
  setShow3DPreviewBusy: (busy: boolean) => void
  applyTexture: () => Promise<boolean>
  exportModel: (format: ExportFormat) => Promise<boolean>
  removeCommitted: (surfaceId: string) => void
  resetAll: () => void
}

export const useBakeStore = create<BakeState>((set, get) => {
  warmupPipelineWorker()

  return {
  status: 'idle',
  committedSurfaceIds: [],
  warnings: [],
  error: null,
  previewActive: false,
  exportQuality: DEFAULT_EXPORT_QUALITY,
  exportActive: false,
  exportProgress: null,
  show3DPreview: false,
  show3DPreviewBusy: false,

  setPreviewActive: (active) => set({ previewActive: active }),

  setExportQuality: (quality) => set({ exportQuality: quality }),

  setShow3DPreview: (show) => set({ show3DPreview: show }),

  setShow3DPreviewBusy: (busy) => set({ show3DPreviewBusy: busy }),

  applyTexture: async () => {
    if (get().status === 'applying') return false

    const loadedModel = useAppStore.getState().loadedModel
    if (!loadedModel) {
      set({ status: 'error', error: 'Load a model before applying a texture.' })
      return false
    }

    const targets = getPatternTargetSurfaces()
    if (targets.length === 0) {
      set({ status: 'error', error: 'Select a surface or part first.' })
      return false
    }

    const active = useSurfaceSelectionStore.getState().selectedSurface
    if (!active) {
      set({ status: 'error', error: 'Select a surface or part first.' })
      return false
    }

    const patternStore = usePatternStore.getState()
    const activeEntry = patternStore.placements[active.surfaceId]
    if (!activeEntry?.settings.patternId) {
      set({ status: 'error', error: 'Choose a texture before applying.' })
      return false
    }

    patternStore.syncActivePlacementToTargets(targets, active.surfaceId)

    set({ status: 'applying', error: null, warnings: [] })

    const warnings: string[] = []
    let committedSurfaceIds = [...get().committedSurfaceIds]
    let appliedCount = 0

    try {
      const placements = usePatternStore.getState().placements
      const coherence = patternStore.patternCoherence

      if (coherence === 'merged' && targets.length > 1) {
        // A PatternRegion's triangles can only reference one mesh's own
        // geometry, so a merge that spans several meshes is still N regions
        // under the hood — group by mesh to build them. But the whole
        // *selection* is meant to read as one object: when it spans more
        // than one mesh, every one of those per-mesh regions shares the same
        // combined world-space bounds (computed once, across all targets)
        // instead of each computing its own — otherwise each mesh's chunk
        // still looks like its own independent pattern, which is exactly the
        // "still per-surface/per-part" symptom this is fixing. A mesh that
        // contributes only one surface to the group still gets folded into
        // that shared frame via commitMergedPatternMaterial, not treated as
        // a lone individual placement.
        const byMesh = new Map<string, typeof targets>()
        for (const surface of targets) {
          const list = byMesh.get(surface.meshUuid) ?? []
          list.push(surface)
          byMesh.set(surface.meshUuid, list)
        }

        const sharedBounds =
          byMesh.size > 1 ? computeSharedWorldBounds(loadedModel.object, targets) : undefined

        for (const [meshUuid, group] of byMesh) {
          const sourceMesh = findMeshByUuid(loadedModel.object, meshUuid)
          if (!sourceMesh) {
            warnings.push(`Skipped ${group[0]!.meshName}: mesh not found.`)
            continue
          }

          const primary = group.find((s) => s.surfaceId === active.surfaceId) ?? group[0]!
          const entry = placements[primary.surfaceId]
          if (!entry?.settings.patternId) {
            warnings.push(`Skipped ${primary.meshName}: no texture chosen.`)
            continue
          }
          try {
            commitMergedPatternMaterial(
              sourceMesh,
              loadedModel.object,
              group,
              entry.settings,
              primary.surfaceId,
              sharedBounds,
            )
            // The merged region absorbs every group member's surfaceId —
            // only the primary needs tracking; drop the others so they
            // don't linger as stale/duplicate committed ids.
            const groupIds = new Set(group.map((s) => s.surfaceId))
            committedSurfaceIds = committedSurfaceIds.filter(
              (id) => !groupIds.has(id) || id === primary.surfaceId,
            )
            if (!committedSurfaceIds.includes(primary.surfaceId)) {
              committedSurfaceIds = [...committedSurfaceIds, primary.surfaceId]
            }
            appliedCount += group.length
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Apply failed.'
            warnings.push(`Could not merge-apply on ${primary.meshName}: ${message}`)
          }
        }
      } else {
        for (const surface of targets) {
          const entry = placements[surface.surfaceId]
          if (!entry?.settings.patternId) {
            warnings.push(`Skipped ${surface.meshName}: no texture chosen.`)
            continue
          }

          const sourceMesh = findMeshByUuid(loadedModel.object, surface.meshUuid)
          if (!sourceMesh) {
            warnings.push(`Skipped ${surface.meshName}: mesh not found.`)
            continue
          }

          try {
            commitPatternMaterial(sourceMesh, loadedModel.object, surface, entry.settings)
            if (!committedSurfaceIds.includes(surface.surfaceId)) {
              committedSurfaceIds = [...committedSurfaceIds, surface.surfaceId]
            }
            appliedCount++
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Apply failed.'
            warnings.push(`Could not apply to ${surface.meshName}: ${message}`)
          }
        }
      }

      if (appliedCount === 0) {
        set({
          status: 'error',
          error: 'Could not apply texture to any selected surface.',
          warnings,
        })
        return false
      }

      set({
        status: 'idle',
        committedSurfaceIds,
        warnings,
        error: null,
        previewActive: false,
      })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apply failed.'
      set({ status: 'error', error: message, warnings })
      return false
    }
  },

  exportModel: async (format) => {
    if (get().exportActive || get().status === 'applying') return false

    const loadedModel = useAppStore.getState().loadedModel
    if (!loadedModel) {
      set({ status: 'error', error: 'Load a model before exporting.' })
      return false
    }

    const placements = usePatternStore.getState().placements
    const committedSurfaceIds = get().committedSurfaceIds
    if (committedSurfaceIds.length === 0) {
      set({ status: 'error', error: 'Apply textures to surfaces before exporting.' })
      return false
    }

    const quality = get().exportQuality
    const fileName = useAppStore.getState().fileName?.replace(/\.[^.]+$/, '') ?? 'textured-model'

    set({
      exportActive: true,
      error: null,
      exportProgress: { fraction: 0, label: 'Starting…' },
    })

    void (async () => {
      try {
        await exportModifiedModel({
          object: loadedModel.object,
          format,
          fileName,
          placements,
          committedSurfaceIds,
          quality,
          exportUnitScale: loadedModel.exportUnitScale,
          onProgress: (fraction, label) => {
            set({ exportProgress: { fraction, label } })
          },
        })
        set({ exportActive: false, exportProgress: null })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export failed.'
        set({ exportActive: false, exportProgress: null, error: message })
      }
    })()

    return true
  },

  removeCommitted: (surfaceId) => {
    const loadedModel = useAppStore.getState().loadedModel
    const removed = uncommitSurfacePattern(loadedModel?.object ?? null, surfaceId)
    if (removed) {
      set({
        committedSurfaceIds: get().committedSurfaceIds.filter((id) => id !== surfaceId),
        previewActive: false,
      })
    }
  },

  resetAll: () => {
    const loadedModel = useAppStore.getState().loadedModel
    resetAllPatterns(loadedModel?.object ?? null)
    set({
      status: 'idle',
      committedSurfaceIds: [],
      warnings: [],
      error: null,
      previewActive: false,
      exportActive: false,
      exportProgress: null,
      show3DPreview: false,
      show3DPreviewBusy: false,
    })
  },
  }
})
