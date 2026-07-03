import { create } from 'zustand'
import type { SelectedSurface } from '../types/surfaceSelection'
import type {
  PatternId,
  SurfacePatternPlacement,
  SurfacePatternSettings,
} from '../types/pattern'
import { DEFAULT_PATTERN_SETTINGS } from '../types/pattern'
import { buildSurfacePlanesFromHighlight } from '../lib/geometry/planarIslands'
import { getSurfaceId, getSurfaceLabel } from '../lib/surface/getSurfaceId'
import { disposePatternTextures, getPatternDefinition } from '../utils/patternTextures'

interface PatternState {
  placements: Record<string, SurfacePatternPlacement>

  getSettings: (surfaceId: string) => SurfacePatternSettings
  getPlacement: (surfaceId: string) => SurfacePatternPlacement | null
  applyPattern: (surface: SelectedSurface, patternId: PatternId) => void
  updateSettings: (surfaceId: string, patch: Partial<SurfacePatternSettings>) => void
  syncSurfacePlane: (surface: SelectedSurface) => void
  resetSurface: (surfaceId: string) => void
  clearAll: () => void
}

function surfaceKey(surface: SelectedSurface): string {
  // Part selections use faceIndex -1 so the whole mesh maps to one placement key.
  const faceIndex = surface.selectionType === 'part' ? -1 : surface.faceIndex
  return getSurfaceId(surface.meshUuid, faceIndex)
}

function buildPlacement(surface: SelectedSurface): Omit<SurfacePatternPlacement, 'settings'> {
  const planes = buildSurfacePlanesFromHighlight(
    surface.highlightGeometry,
    surface.normal,
    surface.point,
  )

  return {
    surfaceId: surfaceKey(surface),
    label: getSurfaceLabel(surface.meshName, surface.faceIndex),
    planes,
  }
}

export const usePatternStore = create<PatternState>((set, get) => ({
  placements: {},

  getSettings: (surfaceId) => {
    return get().placements[surfaceId]?.settings ?? { ...DEFAULT_PATTERN_SETTINGS }
  },

  getPlacement: (surfaceId) => get().placements[surfaceId] ?? null,

  applyPattern: (surface, patternId) => {
    if (!surface.highlightGeometry?.getAttribute('position')) return

    const base = buildPlacement(surface)
    const existing = get().placements[base.surfaceId]
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
        [base.surfaceId]: { ...base, settings },
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

  syncSurfacePlane: (surface) => {
    const surfaceId = surfaceKey(surface)
    const current = get().placements[surfaceId]
    if (!current?.settings.patternId) return

    const base = buildPlacement(surface)
    set({
      placements: {
        ...get().placements,
        [surfaceId]: {
          ...current,
          label: base.label,
          planes: base.planes,
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
