import type { LoadedModel } from '../../types/model'
import { resetAllPatterns } from '../materials/patternMaterialApply'
import { unloadCurrentModel } from '../loaders/loadModel'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'

/** Reset pattern GPU state and app stores before disposing a model. */
export function teardownLoadedModel(model: LoadedModel | null): void {
  resetAllPatterns(model?.object ?? null)

  useSurfaceSelectionStore.getState().clearSelection()
  usePatternStore.getState().clearAll()
  useBakeStore.setState({
    status: 'idle',
    committedSurfaceIds: [],
    warnings: [],
    error: null,
    previewActive: false,
  })

  unloadCurrentModel(model)
}
