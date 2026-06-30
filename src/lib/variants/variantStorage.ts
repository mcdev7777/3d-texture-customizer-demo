import type { PatternPlacement } from '../../types/bake'
import { sanitizePlacements } from './validateVariant'

export const VARIANT_STORAGE_KEY = 'crate3d:variants:v1'

export interface SavedVariant {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  sourceModelName?: string
  placements: PatternPlacement[]
  selectedSurfaceId?: string
  camera?: {
    position: [number, number, number]
    target?: [number, number, number]
  }
  thumbnailDataUrl?: string
  notes?: string
}

function readAll(): SavedVariant[] {
  try {
    const raw = localStorage.getItem(VARIANT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => sanitizeStoredVariant(item))
      .filter((v): v is SavedVariant => v !== null)
  } catch {
    return []
  }
}

function sanitizeStoredVariant(raw: unknown): SavedVariant | null {
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
    selectedSurfaceId:
      typeof v.selectedSurfaceId === 'string' ? v.selectedSurfaceId : undefined,
    camera:
      v.camera && typeof v.camera === 'object'
        ? (v.camera as SavedVariant['camera'])
        : undefined,
    thumbnailDataUrl:
      typeof v.thumbnailDataUrl === 'string' ? v.thumbnailDataUrl : undefined,
    notes: typeof v.notes === 'string' ? v.notes : undefined,
  }
}

function writeAll(variants: SavedVariant[]): boolean {
  try {
    localStorage.setItem(VARIANT_STORAGE_KEY, JSON.stringify(variants))
    return true
  } catch {
    return false
  }
}

export function listVariants(): SavedVariant[] {
  return readAll().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function getVariant(id: string): SavedVariant | null {
  return readAll().find((v) => v.id === id) ?? null
}

export function saveVariant(variant: SavedVariant): SavedVariant {
  const variants = readAll()
  const index = variants.findIndex((v) => v.id === variant.id)
  const sanitized: SavedVariant = {
    ...variant,
    placements: sanitizePlacements(variant.placements),
  }
  if (index >= 0) {
    variants[index] = sanitized
  } else {
    variants.push(sanitized)
  }
  if (!writeAll(variants)) {
    throw new Error('Could not save variant — browser storage may be full.')
  }
  return sanitized
}

export function deleteVariant(id: string): boolean {
  const variants = readAll()
  const next = variants.filter((v) => v.id !== id)
  if (next.length === variants.length) return false
  return writeAll(next)
}

export function renameVariant(id: string, name: string): SavedVariant | null {
  const variants = readAll()
  const variant = variants.find((v) => v.id === id)
  if (!variant) return null
  variant.name = name.trim() || variant.name
  variant.updatedAt = new Date().toISOString()
  if (!writeAll(variants)) return null
  return variant
}

export function duplicateVariant(id: string): SavedVariant | null {
  const source = getVariant(id)
  if (!source) return null
  const now = new Date().toISOString()
  const copy: SavedVariant = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    placements: source.placements.map((p) => ({ ...p, plane: { ...p.plane } })),
  }
  saveVariant(copy)
  return copy
}

export function exportVariantJson(variant: SavedVariant): void {
  const blob = new Blob([JSON.stringify(variant, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${variant.name.replace(/[^\w.-]+/g, '_')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function importVariantJson(json: string): SavedVariant {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid JSON file.')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid variant JSON.')
  }

  const record = parsed as Record<string, unknown>
  if (typeof record.name !== 'string') {
    throw new Error('Invalid variant JSON.')
  }

  const placements = sanitizePlacements(record.placements)
  const now = new Date().toISOString()
  const variant: SavedVariant = {
    id: crypto.randomUUID(),
    name: `${record.name} (imported)`,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
    updatedAt: now,
    sourceModelName:
      typeof record.sourceModelName === 'string' ? record.sourceModelName : undefined,
    placements,
    selectedSurfaceId:
      typeof record.selectedSurfaceId === 'string' ? record.selectedSurfaceId : undefined,
  }
  saveVariant(variant)
  return variant
}

export function createVariantId(): string {
  return crypto.randomUUID()
}
