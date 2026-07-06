import { Group, type Object3D } from 'three'
import type { SurfacePatternPlacement } from '../../types/pattern'
import type { ExportQuality } from '../../types/bake'
import { preparePrintableExport } from './preparePrintableExport'

/** @deprecated Use preparePrintableExport */
export async function buildExportScene(
  root: Object3D,
  options: {
    placements: Record<string, SurfacePatternPlacement>
    committedSurfaceIds: readonly string[]
    quality: ExportQuality
    exportUnitScale: number
  },
): Promise<Group> {
  return preparePrintableExport(root, options)
}
