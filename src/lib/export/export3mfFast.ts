import { BufferAttribute, BufferGeometry, type Object3D } from 'three'
import type { ExportQuality } from '../../types/bake'
import type { SurfacePatternPlacement } from '../../types/pattern'
import { getExportOutputTriangles } from '../geometry/subdivideSelection'
import { build3MFPackage } from '../mesh-engine/exporter.js'
import { bakeMeshRegions } from '../mesh-engine/adapters/bakeMeshRegions'
import { appendMeshSoups, collectExportMeshes } from '../mesh-engine/adapters/collectMeshPositions'
import { mapPipelineProgress } from '../mesh-engine/adapters/runMeshPipeline'
import type { ExportProgressCallback } from './exportProgress'
import type { RepairStats } from '../mesh-engine/exportPipeline'

function logRepairStats(stats: RepairStats): void {
  console.log(
    `%c[3MF export] mesh repair: removed ${stats.beforeSlivers.toLocaleString()} zero-area slivers; ` +
      `final open=${stats.open}, non-manifold=${stats.nonManifold}, slivers=${stats.slivers} ` +
      `(${stats.tris.toLocaleString()} tris)`,
    'color:#0a0;font-weight:bold',
  )
}

/**
 * Fast BumpMesh-style 3MF export: worker pipeline + fflate ZIP writer.
 * Bypasses main-thread relief bake and custom zipWriter.
 */
export async function export3mfFast(
  root: Object3D,
  options: {
    placements: Record<string, SurfacePatternPlacement>
    committedSurfaceIds: readonly string[]
    quality: ExportQuality
    exportUnitScale: number
    smoothnessLevel?: number
    onProgress?: ExportProgressCallback
  },
): Promise<Uint8Array> {
  const { placements, committedSurfaceIds, quality, exportUnitScale, smoothnessLevel = 0, onProgress } = options
  const exportMeshes = collectExportMeshes(root)
  if (exportMeshes.length === 0) {
    throw new Error('No exportable geometry found for 3MF export.')
  }

  onProgress?.(0.02, 'Preparing export…')

  if (import.meta.env.DEV) {
    console.log(
      '[3MF export] quality target triangles:',
      getExportOutputTriangles(quality).toLocaleString(),
    )
  }

  const processedSoups: Float32Array[] = []
  let exportToken = 0
  const myToken = ++exportToken
  const isStale = () => exportToken !== myToken

  for (let meshIndex = 0; meshIndex < exportMeshes.length; meshIndex++) {
    const mesh = exportMeshes[meshIndex]!

    onProgress?.(
      0.04 + (meshIndex / exportMeshes.length) * 0.02,
      exportMeshes.length > 1
        ? `Processing mesh ${meshIndex + 1}/${exportMeshes.length}…`
        : 'Running export pipeline…',
    )

    const result = await bakeMeshRegions(
      mesh,
      root,
      placements,
      committedSurfaceIds,
      quality,
      exportUnitScale,
      exportUnitScale,
      mapPipelineProgress(onProgress, meshIndex, exportMeshes.length),
      isStale,
      [],
      smoothnessLevel,
    )

    if (!result || isStale()) {
      throw new Error('Export was cancelled.')
    }

    if (result.repairStats) {
      logRepairStats(result.repairStats)
    }

    processedSoups.push(result.positions)
  }

  onProgress?.(0.94, 'Writing 3MF…')

  const merged = appendMeshSoups(processedSoups)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(merged, 3))

  const zip = build3MFPackage(geometry)
  geometry.dispose()

  onProgress?.(1, 'Download ready')
  return zip
}
