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
import { assertVariationMatchesLoadedModel } from './modelFileMatch'
import { remapVariationForModel, validateVariationResolution } from './remapVariation'

/** Restore pattern placements, re-apply committed textures, and re-select surface. */
export function applyVariation(
  variation: ModelVariation,
  modelRoot: Object3D,
  currentFileName: string | null,
): void {
  assertVariationMatchesLoadedModel(variation.sourceModelName, currentFileName)
  validateVariationResolution(variation, modelRoot, currentFileName)

  useBakeStore.getState().resetAll()

  const { placements, committedSurfaceIds, selectedSurfaceId } = remapVariationForModel(
    variation,
    modelRoot,
    currentFileName,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Apply failed.'
      throw new Error(`Could not apply variation: ${message}`)
    } finally {
      surface.highlightGeometry.dispose()
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
