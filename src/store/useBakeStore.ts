import { create } from 'zustand'
import type { BakeStatus } from '../types/bake'
import { commitPatternMaterial, resetAllPatterns, uncommitSurfacePattern } from '../lib/materials/patternMaterialApply'
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

  setPreviewActive: (active: boolean) => void
  applyTexture: () => Promise<boolean>
  removeCommitted: (surfaceId: string) => void
  resetAll: () => void
}

export const useBakeStore = create<BakeState>((set, get) => ({
  status: 'idle',
  committedSurfaceIds: [],
  warnings: [],
  error: null,
  previewActive: false,

  setPreviewActive: (active) => set({ previewActive: active }),

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
    })
  },
}))
