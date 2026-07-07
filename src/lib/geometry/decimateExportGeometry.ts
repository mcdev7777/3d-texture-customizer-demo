import { BufferGeometry } from 'three'
// BumpMesh QEM decimator (Garland & Heckbert + PrusaSlicer safety guards).
import { decimate } from './decimateMesh.js'

/**
 * Reduce triangle count while preserving relief detail and sharp creases.
 * Expects millimeter-scale geometry; indexed input is handled directly (no
 * toNonIndexed explosion).
 */
export async function decimateExportGeometry(
  geometry: BufferGeometry,
  targetTriangles: number,
  onProgress?: (fraction: number) => void,
): Promise<BufferGeometry> {
  const triCount = geometry.index
    ? geometry.index.count / 3
    : geometry.getAttribute('position').count / 3

  if (triCount <= targetTriangles) {
    return geometry
  }

  onProgress?.(0)
  const result = await decimate(geometry, targetTriangles, onProgress)
  if (result !== geometry) {
    geometry.dispose()
  }
  return result
}
