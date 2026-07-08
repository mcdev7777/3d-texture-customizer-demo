import { Box3, Vector3, type Object3D } from 'three'
import { DEPTH_MAX, DEPTH_MIN } from '../../types/pattern'

export function getModelMaxDimension(root: Object3D): number {
  const box = new Box3().setFromObject(root)
  const size = new Vector3()
  box.getSize(size)
  return Math.max(size.x, size.y, size.z, 0.001)
}

/**
 * The depth control is a direct real-world measurement: depth 1 means 1mm of
 * relief, depth 2 means 2mm, regardless of model size. (Previously this was
 * a fraction of the model's bounding box, run through a response curve — so
 * the same slider position produced wildly different absolute depths on a
 * 20mm part vs a 200mm one, and never matched a real mm value a print needs.)
 */
export function depthLevelToDisplacementMm(depth: number): number {
  return Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, depth))
}

/**
 * Viewer-normalized-space equivalent of `depthLevelToDisplacementMm`, for
 * code that displaces geometry still in the app's normalized viewer
 * coordinates (shader preview, live 3D-preview bake) rather than real
 * millimetres (export). `exportUnitScale` is mm per viewer unit — see
 * `getExportUnitScale`/`normalizeModel.ts`.
 */
export function depthLevelToDisplacementWorld(depth: number, exportUnitScale: number): number {
  const mm = depthLevelToDisplacementMm(depth)
  if (mm <= 0) return 0
  return mm / Math.max(exportUnitScale, 1e-6)
}
