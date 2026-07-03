import { create } from 'zustand'
import { Group } from 'three'
import type { BakeStatus, ExportFormat } from '../types/bake'
import { placementFromStoreEntry } from '../types/bake'
import {
  buildExportableModifiedObject,
  createPatchGroup,
} from '../lib/geometry/bakePatternGeometry'
import { disposeObject } from '../lib/three/disposeObject'
import { scheduleDisposeObject, disposeExportCloneGeometries } from '../lib/three/scheduleDispose'
import { exportModifiedModel } from '../lib/export/exportModifiedModel'
import { findMeshByUuid } from '../lib/surface/restoreSurfaceFromId'
import { useAppStore } from './useAppStore'
import { usePatternStore } from './usePatternStore'
import { useSurfaceSelectionStore } from './useSurfaceSelectionStore'

/**
 * Scene ownership model:
 * - `useAppStore.loadedModel.object` = the untouched working model (also the reset source).
 * - `committedGroup` = permanent applied relief patches, one per surface. Persists across
 *   previews and is never cleared by preview changes.
 * - Preview lives in `TexturePreviewOverlay` and only reflects the current selection.
 */
interface BakeState {
  status: BakeStatus
  /** Persistent group holding all committed (applied) relief patches. */
  committedGroup: Group
  /** Surface ids that currently have a committed patch (drives re-renders). */
  committedSurfaceIds: string[]
  warnings: string[]
  error: string | null
  segmentCount: number
  previewActive: boolean

  setSegmentCount: (count: number) => void
  setPreviewActive: (active: boolean) => void
  /** Commit the currently selected surface's pattern into permanent relief geometry. */
  applyTexture: () => Promise<boolean>
  /** Remove one committed surface patch. */
  removeCommitted: (surfaceId: string) => void
  /** Remove all committed patches and turn preview off (used by reset / model change). */
  resetAll: () => void
  exportModel: (format: ExportFormat) => Promise<boolean>
}

function createCommittedGroup(): Group {
  const group = new Group()
  group.name = 'CommittedTextureGroup'
  group.userData.exportable = true
  return group
}

function removeCommittedChild(group: Group, surfaceId: string): void {
  const existing = group.children.find((c) => c.userData.surfaceId === surfaceId)
  if (existing) {
    group.remove(existing)
    disposeObject(existing)
  }
}

export const useBakeStore = create<BakeState>((set, get) => ({
  status: 'idle',
  committedGroup: createCommittedGroup(),
  committedSurfaceIds: [],
  warnings: [],
  error: null,
  segmentCount: 64,
  previewActive: false,

  setSegmentCount: (count) =>
    set({ segmentCount: Math.min(128, Math.max(16, Math.floor(count))) }),

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
    const placement = entry
      ? placementFromStoreEntry(selected.surfaceId, entry.label, entry.settings, entry.planes)
      : null
    if (!placement) {
      set({ status: 'error', error: 'Choose a texture before applying.' })
      return false
    }

    set({ status: 'applying', error: null, warnings: [] })

    try {
      const sourceMesh = findMeshByUuid(loadedModel.object, selected.meshUuid)
      const { group: patchGroup, warnings } = createPatchGroup(placement, {
        segmentCount: get().segmentCount,
        role: 'committed',
        sourceMaterial: sourceMesh?.material ?? null,
      })

      const group = get().committedGroup
      // Re-applying to the same surface replaces its previous patch only.
      removeCommittedChild(group, selected.surfaceId)
      group.add(patchGroup)

      const committedSurfaceIds = get().committedSurfaceIds.includes(selected.surfaceId)
        ? get().committedSurfaceIds
        : [...get().committedSurfaceIds, selected.surfaceId]

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
      set({ status: 'error', error: message })
      return false
    }
  },

  removeCommitted: (surfaceId) => {
    const group = get().committedGroup
    removeCommittedChild(group, surfaceId)
    set({
      committedSurfaceIds: get().committedSurfaceIds.filter((id) => id !== surfaceId),
    })
  },

  resetAll: () => {
    const group = get().committedGroup
    const removed = [...group.children]
    group.clear()
    set({
      status: 'idle',
      committedSurfaceIds: [],
      warnings: [],
      error: null,
      previewActive: false,
    })
    removed.forEach((child) => scheduleDisposeObject(child))
  },

  exportModel: async (format) => {
    const loadedModel = useAppStore.getState().loadedModel
    if (!loadedModel) {
      set({ status: 'error', error: 'Load a model before exporting.' })
      return false
    }

    const group = get().committedGroup
    if (group.children.length === 0) {
      set({ status: 'error', error: 'Apply a texture before exporting.' })
      return false
    }

    const fileName = 'crate3d-textured-model'

    set({ status: 'exporting', error: null })

    const exportObject = buildExportableModifiedObject(loadedModel.object, group)
    try {
      await exportModifiedModel({ object: exportObject, format, fileName })
      set({ status: 'idle', error: null })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed.'
      set({ status: 'error', error: message })
      return false
    } finally {
      // Dispose only the geometry clones we created — materials are shared with the live scene.
      disposeExportCloneGeometries(exportObject)
    }
  },
}))
