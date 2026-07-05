import { Box3, Vector3, type Object3D } from 'three'
import { DEPTH_MAX, DEPTH_MIN } from '../../types/pattern'

/** Max displacement as fraction of model bounding size. */
export const MAX_DISPLACEMENT_FRACTION = 0.12

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Normalized depth response: 0.25 subtle, 1 clear, 2 max.
 */
export function depthCurve(level: number): number {
  const clamped = Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, level))
  if (clamped <= 0) return 0

  if (clamped <= 0.25) {
    const t = (clamped - DEPTH_MIN) / Math.max(0.25 - DEPTH_MIN, 1e-6)
    return 0.04 + smoothstep01(t) * 0.14
  }
  if (clamped <= 1) {
    const t = (clamped - 0.25) / 0.75
    return 0.18 + smoothstep01(t) * 0.32
  }
  const t = (clamped - 1) / Math.max(DEPTH_MAX - 1, 1e-6)
  return 0.5 + smoothstep01(t) * 0.5
}

export function getModelMaxDimension(root: Object3D): number {
  const box = new Box3().setFromObject(root)
  const size = new Vector3()
  box.getSize(size)
  return Math.max(size.x, size.y, size.z, 0.001)
}

/** World-space amplitude for bump preview and geometry displacement. */
export function depthLevelToDisplacementWorld(depth: number, modelMaxDim: number): number {
  const curved = depthCurve(depth)
  if (curved <= 0) return 0
  return modelMaxDim * MAX_DISPLACEMENT_FRACTION * curved
}
