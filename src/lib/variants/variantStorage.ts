import type { ModelVariation, VariationPlacement } from '../../types/variant'
import type { SurfacePatternPlacement } from '../../types/pattern'
import { sanitizeCommittedIds, sanitizePlacements } from './validateVariant'
import { findMeshByUuid, parseSurfaceId } from '../surface/restoreSurfaceFromId'
import { getMeshOrdinal, getMeshPath } from '../surface/meshPath'
import type { Object3D } from 'three'

export const VARIATION_STORAGE_KEY = 'texture-studio:variations:v1'

function readAll(): ModelVariation[] {
  try {
    const raw = localStorage.getItem(VARIATION_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => sanitizeStoredVariation(item))
      .filter((v): v is ModelVariation => v !== null)
  } catch {
    return []
  }
}

function sanitizeStoredVariation(raw: unknown): ModelVariation | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return null
  if (typeof v.createdAt !== 'string' || typeof v.updatedAt !== 'string') return null

  const placements = sanitizePlacements(v.placements)
  return {
    id: v.id,
    name: v.name,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    sourceModelName: typeof v.sourceModelName === 'string' ? v.sourceModelName : undefined,
    placements,
    committedSurfaceIds: sanitizeCommittedIds(v.committedSurfaceIds, placements),
    selectedSurfaceId:
      typeof v.selectedSurfaceId === 'string' ? v.selectedSurfaceId : undefined,
  }
}

function writeAll(variations: ModelVariation[]): boolean {
  try {
    localStorage.setItem(VARIATION_STORAGE_KEY, JSON.stringify(variations))
    return true
  } catch {
    return false
  }
}

export function listVariations(): ModelVariation[] {
  return readAll().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function getVariation(id: string): ModelVariation | null {
  return readAll().find((v) => v.id === id) ?? null
}

export function saveVariation(variation: ModelVariation): ModelVariation {
  const variations = readAll()
  const index = variations.findIndex((v) => v.id === variation.id)
  const placements = sanitizePlacements(variation.placements)
  const sanitized: ModelVariation = {
    ...variation,
    placements,
    committedSurfaceIds: sanitizeCommittedIds(variation.committedSurfaceIds, placements),
  }
  if (index >= 0) variations[index] = sanitized
  else variations.push(sanitized)

  if (!writeAll(variations)) {
    throw new Error('Could not save variation — browser storage may be full.')
  }
  return sanitized
}

export function deleteVariation(id: string): boolean {
  const variations = readAll()
  const next = variations.filter((v) => v.id !== id)
  if (next.length === variations.length) return false
  return writeAll(next)
}

export function renameVariation(id: string, name: string): ModelVariation | null {
  const variations = readAll()
  const variation = variations.find((v) => v.id === id)
  if (!variation) return null
  variation.name = name.trim() || variation.name
  variation.updatedAt = new Date().toISOString()
  if (!writeAll(variations)) return null
  return variation
}

export function duplicateVariation(id: string): ModelVariation | null {
  const source = getVariation(id)
  if (!source) return null
  const now = new Date().toISOString()
  const copy: ModelVariation = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    placements: source.placements.map((p) => ({
      ...p,
      settings: { ...p.settings },
    })),
    committedSurfaceIds: [...source.committedSurfaceIds],
  }
  saveVariation(copy)
  return copy
}

export function exportVariationJson(variation: ModelVariation): void {
  const blob = new Blob([JSON.stringify(variation, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${variation.name.replace(/[^\w.-]+/g, '_')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function importVariationJson(json: string): ModelVariation {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid JSON file.')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid variation JSON.')
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.name !== 'string') {
    throw new Error('Invalid variation JSON.')
  }

  const placements = sanitizePlacements(record.placements)
  const now = new Date().toISOString()
  const variation: ModelVariation = {
    id: crypto.randomUUID(),
    name: `${record.name} (imported)`,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
    updatedAt: now,
    sourceModelName:
      typeof record.sourceModelName === 'string' ? record.sourceModelName : undefined,
    placements,
    committedSurfaceIds: sanitizeCommittedIds(record.committedSurfaceIds, placements),
    selectedSurfaceId:
      typeof record.selectedSurfaceId === 'string' ? record.selectedSurfaceId : undefined,
  }
  saveVariation(variation)
  return variation
}

export function createVariationId(): string {
  return crypto.randomUUID()
}

export function placementsToSerializable(
  placements: Record<string, SurfacePatternPlacement>,
  modelRoot: Object3D | null,
): VariationPlacement[] {
  return Object.values(placements)
    .filter((p) => p.settings.patternId != null)
    .map((p) => {
      const parsed = parseSurfaceId(p.surfaceId)
      let meshPath = ''
      let meshOrdinal = -1

      if (modelRoot && parsed) {
        const mesh = findMeshByUuid(modelRoot, parsed.meshUuid)
        if (mesh) {
          meshPath = getMeshPath(mesh, modelRoot)
          meshOrdinal = getMeshOrdinal(mesh, modelRoot)
        }
      }

      return {
        surfaceId: p.surfaceId,
        label: p.label,
        settings: { ...p.settings },
        meshPath,
        meshOrdinal,
      }
    })
}
