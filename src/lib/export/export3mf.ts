/**
 * Thin wrapper around mesh-engine build3MFPackage (fflate + QuantizedPointMap).
 * @deprecated Use export3mfFast for the full pipeline; this remains for legacy callers.
 */
import type { Object3D } from 'three'
import { BufferAttribute, BufferGeometry } from 'three'
import { collectExportableMeshes } from './collectExportableMeshes'
import type { ExportProgressCallback } from './exportProgress'
import { build3MFPackage } from '../mesh-engine/exporter.js'

export async function export3mf(
  object: Object3D,
  onProgress?: ExportProgressCallback,
): Promise<Uint8Array> {
  onProgress?.(0.02, 'Collecting geometry…')
  const { vertices, indices } = collectExportableMeshes(object)
  if (indices.length === 0) {
    throw new Error('No exportable geometry found for 3MF export.')
  }

  onProgress?.(0.5, 'Building 3MF model…')

  const triCount = indices.length / 3
  const positions = new Float32Array(triCount * 9)
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k]!
      const src = vi * 3
      const dst = t * 9 + k * 3
      positions[dst] = vertices[src]!
      positions[dst + 1] = vertices[src + 1]!
      positions[dst + 2] = vertices[src + 2]!
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const zip = build3MFPackage(geometry)
  geometry.dispose()

  onProgress?.(1, 'Done')
  return zip
}
