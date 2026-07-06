import type { Object3D } from 'three'
import type { ModelVariation, VariationPlacement } from '../../types/variant'
import type { SurfacePatternPlacement } from '../../types/pattern'
import { DEFAULT_PATTERN_SETTINGS } from '../../types/pattern'
import { getSurfaceId } from '../surface/getSurfaceId'
import { meshNameFromLabel, resolveMesh, type MeshResolveMode } from '../surface/meshPath'
import { parseSurfaceId } from '../surface/restoreSurfaceFromId'
import { modelFileNamesMatch } from './modelFileMatch'

export interface RemappedVariation {
  placements: Record<string, SurfacePatternPlacement>
  committedSurfaceIds: string[]
  selectedSurfaceId?: string
}

function resolveModeForVariation(
  variation: ModelVariation,
  currentFileName: string | null,
): MeshResolveMode {
  if (modelFileNamesMatch(variation.sourceModelName, currentFileName)) {
    return 'reload'
  }
  return 'strict'
}

function remapSurfaceId(
  placement: VariationPlacement,
  modelRoot: Object3D,
  mode: MeshResolveMode,
): string | null {
  const parsed = parseSurfaceId(placement.surfaceId)
  if (!parsed) return null

  const mesh = resolveMesh(
    modelRoot,
    {
      uuid: parsed.meshUuid,
      meshPath: placement.meshPath,
      meshOrdinal: placement.meshOrdinal,
      meshName: meshNameFromLabel(placement.label) ?? undefined,
    },
    mode,
  )
  if (!mesh) return null

  return getSurfaceId(mesh.uuid, parsed.faceIndex)
}

/** Map saved surface ids (uuid-based) to ids for the currently loaded model. */
export function remapVariationForModel(
  variation: ModelVariation,
  modelRoot: Object3D,
  currentFileName: string | null,
): RemappedVariation {
  const mode = resolveModeForVariation(variation, currentFileName)
  const idMap = new Map<string, string>()

  for (const placement of variation.placements) {
    const newId = remapSurfaceId(placement, modelRoot, mode)
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

export function countResolvedMeshes(
  variation: ModelVariation,
  modelRoot: Object3D,
  currentFileName: string | null,
): number {
  const mode = resolveModeForVariation(variation, currentFileName)
  let count = 0
  for (const placement of variation.placements) {
    if (remapSurfaceId(placement, modelRoot, mode)) count++
  }
  return count
}

export function validateVariationResolution(
  variation: ModelVariation,
  modelRoot: Object3D,
  currentFileName: string | null,
): void {
  const total = variation.placements.length
  if (total === 0) return

  const resolved = countResolvedMeshes(variation, modelRoot, currentFileName)
  if (resolved === total) return

  if (variation.sourceModelName && currentFileName && !modelFileNamesMatch(variation.sourceModelName, currentFileName)) {
    throw new Error(
      `This variation was saved for "${variation.sourceModelName}", but the loaded model is "${currentFileName}". Load the same file, or save a new variation for this model.`,
    )
  }

  throw new Error(
    'Could not match saved surfaces to this model. Reload the same file, then save the variation again.',
  )
}
