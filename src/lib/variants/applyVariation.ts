import type { Object3D } from 'three'
import type { ModelVariation } from '../../types/variant'
import { commitPatternMaterial } from '../materials/patternMaterialApply'
import {
  buildSelectedSurfaceFromId,
  findMeshByUuid,
  parseSurfaceId,
  restoreSurfaceSelection,
} from '../surface/restoreSurfaceFromId'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { countResolvedMeshes, remapVariationForModel } from './remapVariation'

/** Restore pattern placements, re-apply committed textures, and re-select surface. */
export function applyVariation(variation: ModelVariation, modelRoot: Object3D): void {
  const resolved = countResolvedMeshes(variation, modelRoot)
  if (variation.placements.length > 0 && resolved === 0) {
    throw new Error(
      'Could not match saved surfaces to this model. Reload the same file, then save the variation again.',
    )
  }

  useBakeStore.getState().resetAll()

  const { placements, committedSurfaceIds, selectedSurfaceId } = remapVariationForModel(
    variation,
    modelRoot,
  )

  usePatternStore.setState({ placements })

  const appliedCommitted: string[] = []

  for (const surfaceId of committedSurfaceIds) {
    const entry = placements[surfaceId]
    if (!entry?.settings.patternId) continue

    const parsed = parseSurfaceId(surfaceId)
    if (!parsed) continue

    const mesh = findMeshByUuid(modelRoot, parsed.meshUuid)
    if (!mesh) continue

    const surface = buildSelectedSurfaceFromId(surfaceId, modelRoot)
    if (!surface) continue

    try {
      commitPatternMaterial(mesh, modelRoot, surface, entry.settings)
      appliedCommitted.push(surfaceId)
    } catch {
      // Skip surfaces that fail to apply.
    }
  }

  useBakeStore.setState({
    status: 'idle',
    committedSurfaceIds: appliedCommitted,
    warnings: [],
    error: null,
    previewActive: false,
  })

  restoreSurfaceSelection(selectedSurfaceId, modelRoot)
}
