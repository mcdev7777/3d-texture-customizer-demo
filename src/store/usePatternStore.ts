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
import { disposePatternTextureCache } from '../lib/materials/patternTexture'

interface PatternState {
  placements: Record<string, SurfacePatternPlacement>

  getSettings: (surfaceId: string) => SurfacePatternSettings
  getPlacement: (surfaceId: string) => SurfacePatternPlacement | null
  applyPattern: (surface: SelectedSurface, patternId: PatternId) => void
  applyPatternToMany: (surfaces: SelectedSurface[], patternId: PatternId) => void
  updateSettings: (surfaceId: string, patch: Partial<SurfacePatternSettings>) => void
  updateSettingsMany: (surfaceIds: string[], patch: Partial<SurfacePatternSettings>) => void
  syncActivePlacementToTargets: (surfaces: SelectedSurface[], activeSurfaceId: string) => void
  resetSurface: (surfaceId: string) => void
  clearAll: () => void
}

function surfaceKey(surface: SelectedSurface): string {
  // Part selections use faceIndex -1 so the whole mesh maps to one placement key.
  const faceIndex = surface.selectionType === 'part' ? -1 : surface.faceIndex
  return getSurfaceId(surface.meshUuid, faceIndex)
}

function settingsEqual(a: SurfacePatternSettings, b: SurfacePatternSettings): boolean {
  return (
    a.patternId === b.patternId &&
    a.mode === b.mode &&
    a.scale === b.scale &&
    a.rotation === b.rotation &&
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.depth === b.depth &&
    a.opacity === b.opacity &&
    a.smoothing === b.smoothing &&
    a.invert === b.invert &&
    a.symmetric === b.symmetric
  )
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

  applyPatternToMany: (surfaces, patternId) => {
    if (surfaces.length === 0) return

    const next = { ...get().placements }
    const definition = getPatternDefinition(patternId)

    for (const surface of surfaces) {
      if (!surface.highlightGeometry?.getAttribute('position')) continue

      const surfaceId = surfaceKey(surface)
      const label = getSurfaceLabel(surface.meshName, surface.faceIndex)
      const existing = next[surfaceId]
      const settings: SurfacePatternSettings = existing?.settings
        ? { ...existing.settings, patternId }
        : {
            ...DEFAULT_PATTERN_SETTINGS,
            patternId,
            scale: definition.defaultScale,
            depth: definition.defaultDepth,
          }

      next[surfaceId] = { surfaceId, label, settings }
    }

    set({ placements: next })
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

  updateSettingsMany: (surfaceIds, patch) => {
    const next = { ...get().placements }
    let changed = false

    for (const surfaceId of surfaceIds) {
      const current = next[surfaceId]
      if (!current?.settings.patternId) continue
      next[surfaceId] = {
        ...current,
        settings: { ...current.settings, ...patch },
      }
      changed = true
    }

    if (changed) set({ placements: next })
  },

  syncActivePlacementToTargets: (surfaces, activeSurfaceId) => {
    const source = get().placements[activeSurfaceId]
    if (!source?.settings.patternId) return

    const next = { ...get().placements }
    let changed = false

    for (const surface of surfaces) {
      if (surface.surfaceId === activeSurfaceId) continue

      const existing = next[surface.surfaceId]
      const label = getSurfaceLabel(surface.meshName, surface.faceIndex)
      const settings = { ...source.settings }

      if (existing && settingsEqual(existing.settings, settings)) continue

      next[surface.surfaceId] = {
        surfaceId: surface.surfaceId,
        label,
        settings,
      }
      changed = true
    }

    if (changed) set({ placements: next })
  },

  resetSurface: (surfaceId) => {
    const next = { ...get().placements }
    delete next[surfaceId]
    set({ placements: next })
  },

  clearAll: () => {
    set({ placements: {} })
    disposePatternTextures()
    disposePatternTextureCache()
  },
}))
