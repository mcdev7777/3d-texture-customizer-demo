import type { PatternId, SurfacePatternSettings } from '../../types/pattern'
import { DEPTH_MAX, DEPTH_MIN, DEFAULT_PATTERN_SETTINGS } from '../../types/pattern'
import type { VariationPlacement } from '../../types/variant'

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPatternId(value: unknown): value is PatternId {
  return typeof value === 'string' && value.length > 0
}

function sanitizeSettings(raw: unknown): SurfacePatternSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!isPatternId(s.patternId)) return null
  if (s.mode !== 'emboss' && s.mode !== 'engrave') return null
  if (!isNumber(s.scale) || !isNumber(s.rotation) || !isNumber(s.offsetX) || !isNumber(s.offsetY)) {
    return null
  }
  if (!isNumber(s.depth) || !isNumber(s.opacity)) return null

  return {
    patternId: s.patternId,
    mode: s.mode,
    scale: s.scale,
    scaleX: isNumber(s.scaleX) ? s.scaleX : s.scale,
    scaleY: isNumber(s.scaleY) ? s.scaleY : s.scale,
    rotation: s.rotation,
    offsetX: s.offsetX,
    offsetY: s.offsetY,
    depth: Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, s.depth)),
    opacity: Math.min(1, Math.max(0, s.opacity)),
    smoothing: isNumber(s.smoothing) ? Math.min(1, Math.max(0, s.smoothing)) : DEFAULT_PATTERN_SETTINGS.smoothing,
    invert: s.invert === true,
    symmetric: s.symmetric === true,
  }
}

export function sanitizeVariationPlacement(raw: unknown): VariationPlacement | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.surfaceId !== 'string' || typeof p.label !== 'string') return null

  const settings = sanitizeSettings(p.settings)
  if (!settings) return null

  return {
    surfaceId: p.surfaceId,
    label: p.label,
    settings,
    meshPath: typeof p.meshPath === 'string' ? p.meshPath : '',
    meshOrdinal: isNumber(p.meshOrdinal) ? Math.max(-1, Math.floor(p.meshOrdinal)) : -1,
  }
}

/** @deprecated alias */
export function sanitizePlacement(raw: unknown): VariationPlacement | null {
  return sanitizeVariationPlacement(raw)
}

export function sanitizePlacements(raw: unknown): VariationPlacement[] {
  if (!Array.isArray(raw)) return []
  const result: VariationPlacement[] = []
  for (const item of raw) {
    const placement = sanitizeVariationPlacement(item)
    if (placement) result.push(placement)
  }
  return result
}

export function sanitizeCommittedIds(raw: unknown, placements: VariationPlacement[]): string[] {
  if (!Array.isArray(raw)) return []
  const valid = new Set(placements.map((p) => p.surfaceId))
  return raw.filter((id): id is string => typeof id === 'string' && valid.has(id))
}
