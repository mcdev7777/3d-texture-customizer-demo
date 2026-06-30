import { create } from 'zustand'
import type { Object3D } from 'three'
import type { BakeStatus, ExportFormat, PatternPlacement } from '../types/bake'
import {
  bakePatternGeometry,
  collectPlacementsFromStore,
} from '../lib/geometry/bakePatternGeometry'
import { scheduleDisposeObject } from '../lib/three/scheduleDispose'
import { exportModifiedModel } from '../lib/export/exportModifiedModel'
import { useAppStore } from './useAppStore'
import { usePatternStore } from './usePatternStore'
import { useSurfaceSelectionStore } from './useSurfaceSelectionStore'

interface BakeState {
  status: BakeStatus
  bakedObject: Object3D | null
  bakedSurfaceIds: string[]
  warnings: string[]
  error: string | null
  showBakedInScene: boolean
  segmentCount: number
  autoBakeOnExport: boolean

  markPending: () => void
  setShowBakedInScene: (show: boolean) => void
  setSegmentCount: (count: number) => void
  clearBake: () => void
  bake: () => Promise<boolean>
  exportModel: (format: ExportFormat) => Promise<boolean>
}

function hasActivePlacements(): boolean {
  const placements = usePatternStore.getState().placements
  return Object.values(placements).some((p) => p.settings.patternId !== null)
}

function derivePreviewStatus(): BakeStatus {
  if (!useAppStore.getState().loadedModel) return 'idle'
  return hasActivePlacements() ? 'preview' : 'idle'
}

export const useBakeStore = create<BakeState>((set, get) => ({
  status: 'idle',
  bakedObject: null,
  bakedSurfaceIds: [],
  warnings: [],
  error: null,
  showBakedInScene: true,
  segmentCount: 64,
  autoBakeOnExport: true,

  markPending: () => {
    const current = get()
    if (
      current.status === 'baking' ||
      current.status === 'exporting' ||
      current.status === 'preparing'
    ) {
      return
    }

    if (!hasActivePlacements()) {
      const previous = current.bakedObject
      set({
        status: 'idle',
        bakedObject: null,
        bakedSurfaceIds: [],
        warnings: [],
        error: null,
      })
      scheduleDisposeObject(previous)
      return
    }

    if (current.bakedObject) {
      const previous = current.bakedObject
      set({
        status: 'bake-pending',
        bakedObject: null,
        bakedSurfaceIds: [],
        warnings: [],
        error: null,
      })
      scheduleDisposeObject(previous)
      return
    }

    set({
      status: 'preview',
      error: null,
    })
  },

  setShowBakedInScene: (show) => set({ showBakedInScene: show }),

  setSegmentCount: (count) => {
    set({ segmentCount: Math.min(128, Math.max(16, Math.floor(count))) })
    get().markPending()
  },

  clearBake: () => {
    const previous = get().bakedObject
    set({
      status: derivePreviewStatus(),
      bakedObject: null,
      bakedSurfaceIds: [],
      warnings: [],
      error: null,
    })
    scheduleDisposeObject(previous)
  },

  bake: async () => {
    const loadedModel = useAppStore.getState().loadedModel
    if (!loadedModel) {
      set({ status: 'error', error: 'Load a model before baking.' })
      return false
    }

    const placements = collectPlacementsFromStore(usePatternStore.getState().placements)
    if (placements.length === 0) {
      set({ status: 'error', error: 'Apply at least one pattern before baking.' })
      return false
    }

    const selectedSurfaceId = useSurfaceSelectionStore.getState().selectedSurface?.surfaceId

    set({ status: 'baking', error: null, warnings: [] })

    try {
      const previous = get().bakedObject
      set({ bakedObject: null, bakedSurfaceIds: [] })
      scheduleDisposeObject(previous)

      const result = await bakePatternGeometry(loadedModel.object, {
        placements,
        selectedSurfaceId,
        segmentCount: get().segmentCount,
        includeTextures: true,
      })

      set({
        status: 'export-ready',
        bakedObject: result.object,
        bakedSurfaceIds: placements.map((p) => p.surfaceId),
        warnings: result.warnings,
        error: null,
      })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bake failed.'
      set({ status: 'error', error: message })
      return false
    }
  },

  exportModel: async (format) => {
    set({ error: null })

    let object = get().bakedObject
    if (!object && get().autoBakeOnExport) {
      set({ status: 'preparing' })
      const baked = await get().bake()
      if (!baked) return false
      object = get().bakedObject
    }

    if (!object) {
      set({
        status: 'error',
        error: 'Bake geometry first, or enable auto-bake on export.',
      })
      return false
    }

    const fileName = useAppStore.getState().fileName?.replace(/\.[^.]+$/, '') ?? 'crate3d-model'

    set({ status: 'exporting' })
    try {
      await exportModifiedModel({ object, format, fileName })
      set({ status: 'complete', error: null })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed.'
      set({ status: 'error', error: message })
      return false
    }
  },
}))

export function placementsToSerializable(
  placements: ReturnType<typeof usePatternStore.getState>['placements'],
): PatternPlacement[] {
  return collectPlacementsFromStore(placements)
}
