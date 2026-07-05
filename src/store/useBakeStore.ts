import { create } from 'zustand'
import type { BakeStatus } from '../types/bake'
import { commitPatternMaterial, resetAllPatterns, uncommitSurfacePattern } from '../lib/materials/patternMaterialApply'
import { findMeshByUuid } from '../lib/surface/restoreSurfaceFromId'
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
    const loadedModel = useAppStore.getState().loadedModel
    if (!loadedModel) {
      set({ status: 'error', error: 'Load a model before applying a texture.' })
      return false
    }

    const selected = useSurfaceSelectionStore.getState().selectedSurface
    if (!selected) {
      set({ status: 'error', error: 'Select a surface or part first.' })
      return false
    }

    const entry = usePatternStore.getState().placements[selected.surfaceId]
    if (!entry?.settings.patternId) {
      set({ status: 'error', error: 'Choose a texture before applying.' })
      return false
    }

    set({ status: 'applying', error: null, warnings: [] })

    try {
      const sourceMesh = findMeshByUuid(loadedModel.object, selected.meshUuid)
      if (!sourceMesh) {
        set({ status: 'error', error: 'Could not find mesh in model.' })
        return false
      }

      commitPatternMaterial(sourceMesh, loadedModel.object, selected, entry.settings)

      const committedSurfaceIds = get().committedSurfaceIds.includes(selected.surfaceId)
        ? get().committedSurfaceIds
        : [...get().committedSurfaceIds, selected.surfaceId]

      set({
        status: 'idle',
        committedSurfaceIds,
        warnings: [],
        error: null,
        previewActive: false,
      })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apply failed.'
      set({ status: 'error', error: message })
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
