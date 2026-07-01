import type { PatternId } from '../../types/pattern'
import type { PatternPlacement } from '../../types/bake'
import { PATTERN_DEFINITIONS } from '../../utils/patternTextures'

const VALID_PATTERN_IDS = new Set<PatternId>(PATTERN_DEFINITIONS.map((p) => p.id))

export function isValidPatternId(value: unknown): value is PatternId {
  return typeof value === 'string' && VALID_PATTERN_IDS.has(value as PatternId)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTuple3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isNumber(value[0]) &&
    isNumber(value[1]) &&
    isNumber(value[2])
  )
}

function isTuple4(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    isNumber(value[0]) &&
    isNumber(value[1]) &&
    isNumber(value[2]) &&
    isNumber(value[3])
  )
}

export function sanitizePatternPlacement(raw: unknown): PatternPlacement | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.surfaceId !== 'string' || typeof p.label !== 'string') return null
  if (!isValidPatternId(p.patternId)) return null
  if (p.mode !== 'emboss' && p.mode !== 'engrave') return null
  if (!isNumber(p.scale) || !isNumber(p.rotation) || !isNumber(p.offsetX) || !isNumber(p.offsetY)) {
    return null
  }
  if (!isNumber(p.depth) || !isNumber(p.opacity)) return null

  const plane = p.plane as Record<string, unknown> | undefined
  if (!plane || !isTuple3(plane.center) || !isTuple3(plane.normal)) return null
  if (!isNumber(plane.width) || !isNumber(plane.height)) return null
  if (!isTuple4(plane.quaternion)) return null

  return {
    surfaceId: p.surfaceId,
    label: p.label,
    patternId: p.patternId,
    mode: p.mode,
    scale: p.scale,
    rotation: p.rotation,
    offsetX: p.offsetX,
    offsetY: p.offsetY,
    depth: Math.min(Math.max(p.depth, 0), 0.15),
    opacity: Math.min(Math.max(p.opacity, 0), 1),
    plane: {
      center: plane.center,
      normal: plane.normal,
      width: Math.max(plane.width, 0.05),
      height: Math.max(plane.height, 0.05),
      quaternion: plane.quaternion,
    },
  }
}

export function sanitizePlacements(raw: unknown): PatternPlacement[] {
  if (!Array.isArray(raw)) return []
  const result: PatternPlacement[] = []
  for (const item of raw) {
    const placement = sanitizePatternPlacement(item)
    if (placement) result.push(placement)
  }
  return result
}
