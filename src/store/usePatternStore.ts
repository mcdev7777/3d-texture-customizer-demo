import { create } from 'zustand'
import type { SelectedSurface } from '../types/surfaceSelection'
import type {
  PatternId,
  SurfacePatternPlacement,
  SurfacePatternSettings,
} from '../types/pattern'
import { DEFAULT_PATTERN_SETTINGS } from '../types/pattern'
import { getSurfaceId, getSurfaceLabel } from '../lib/surface/getSurfaceId'
import { disposePatternTextures, getPatternDefinition } from '../utils/patternTextures'

interface PatternState {
  placements: Record<string, SurfacePatternPlacement>

  getSettings: (surfaceId: string) => SurfacePatternSettings
  getPlacement: (surfaceId: string) => SurfacePatternPlacement | null
  applyPattern: (surface: SelectedSurface, patternId: PatternId) => void
  updateSettings: (surfaceId: string, patch: Partial<SurfacePatternSettings>) => void
  resetSurface: (surfaceId: string) => void
  clearAll: () => void
}

function surfaceKey(surface: SelectedSurface): string {
  // Part selections use faceIndex -1 so the whole mesh maps to one placement key.
  const faceIndex = surface.selectionType === 'part' ? -1 : surface.faceIndex
  return getSurfaceId(surface.meshUuid, faceIndex)
}

export const usePatternStore = create<PatternState>((set, get) => ({
  placements: {},

  getSettings: (surfaceId) => {
    return get().placements[surfaceId]?.settings ?? { ...DEFAULT_PATTERN_SETTINGS }
  },

  getPlacement: (surfaceId) => get().placements[surfaceId] ?? null,

  applyPattern: (surface, patternId) => {
    if (!surface.highlightGeometry?.getAttribute('position')) return

    const surfaceId = surfaceKey(surface)
    const label = getSurfaceLabel(surface.meshName, surface.faceIndex)
    const existing = get().placements[surfaceId]
    const definition = getPatternDefinition(patternId)
    const settings: SurfacePatternSettings = existing?.settings
      ? { ...existing.settings, patternId }
      : {
          ...DEFAULT_PATTERN_SETTINGS,
          patternId,
          scale: definition.defaultScale,
          depth: definition.defaultDepth,
        }

    set({
      placements: {
        ...get().placements,
        [surfaceId]: { surfaceId, label, settings },
      },
    })
  },

  updateSettings: (surfaceId, patch) => {
    const current = get().placements[surfaceId]
    if (!current?.settings.patternId) return

    set({
      placements: {
        ...get().placements,
        [surfaceId]: {
          ...current,
          settings: { ...current.settings, ...patch },
        },
      },
    })
  },

  resetSurface: (surfaceId) => {
    const next = { ...get().placements }
    delete next[surfaceId]
    set({ placements: next })
  },

  clearAll: () => {
    set({ placements: {} })
    disposePatternTextures()
  },
}))
