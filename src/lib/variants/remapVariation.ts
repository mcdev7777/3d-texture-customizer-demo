import type { Object3D } from 'three'
import type { ModelVariation, VariationPlacement } from '../../types/variant'
import type { SurfacePatternPlacement } from '../../types/pattern'
import { DEFAULT_PATTERN_SETTINGS } from '../../types/pattern'
import { getSurfaceId } from '../surface/getSurfaceId'
import { meshNameFromLabel, resolveMesh } from '../surface/meshPath'
import { parseSurfaceId } from '../surface/restoreSurfaceFromId'

export interface RemappedVariation {
  placements: Record<string, SurfacePatternPlacement>
  committedSurfaceIds: string[]
  selectedSurfaceId?: string
}

function remapSurfaceId(
  placement: VariationPlacement,
  modelRoot: Object3D,
): string | null {
  const parsed = parseSurfaceId(placement.surfaceId)
  if (!parsed) return null

  const mesh = resolveMesh(modelRoot, {
    uuid: parsed.meshUuid,
    meshPath: placement.meshPath,
    meshOrdinal: placement.meshOrdinal,
    meshName: meshNameFromLabel(placement.label) ?? undefined,
  })
  if (!mesh) return null

  return getSurfaceId(mesh.uuid, parsed.faceIndex)
}

/** Map saved surface ids (uuid-based) to ids for the currently loaded model. */
export function remapVariationForModel(
  variation: ModelVariation,
  modelRoot: Object3D,
): RemappedVariation {
  const idMap = new Map<string, string>()

  for (const placement of variation.placements) {
    const newId = remapSurfaceId(placement, modelRoot)
    if (newId) idMap.set(placement.surfaceId, newId)
  }

  const placements: Record<string, SurfacePatternPlacement> = {}
  for (const placement of variation.placements) {
    const newId = idMap.get(placement.surfaceId)
    if (!newId) continue
    placements[newId] = {
      surfaceId: newId,
      label: placement.label,
      settings: { ...DEFAULT_PATTERN_SETTINGS, ...placement.settings },
    }
  }

  const committedSurfaceIds = variation.committedSurfaceIds
    .map((id) => idMap.get(id))
    .filter((id): id is string => !!id)

  const selectedSurfaceId = variation.selectedSurfaceId
    ? idMap.get(variation.selectedSurfaceId)
    : undefined

  return { placements, committedSurfaceIds, selectedSurfaceId }
}

export function countResolvedMeshes(variation: ModelVariation, modelRoot: Object3D): number {
  let count = 0
  for (const placement of variation.placements) {
    if (remapSurfaceId(placement, modelRoot)) count++
  }
  return count
}
