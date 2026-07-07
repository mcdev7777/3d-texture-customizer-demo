import type { Object3D } from 'three'
import type { ExportQuality } from '../../../types/bake'
import type { PatternRegion } from '../../materials/patternMaterialApply'
import { EXPORT_QUALITY, getExportOutputTriangles } from '../../geometry/subdivideSelection'
import { depthLevelToDisplacementWorld, getModelMaxDimension } from '../../pattern/patternDepth'
import type { EngineSettings, RegularizeOpts } from '../exportPipeline'

/** BumpMesh mapping.js MODE_CUBIC */
export const MODE_CUBIC = 6
/** BumpMesh mapping.js MODE_TRIPLANAR */
export const MODE_TRIPLANAR = 5

export function mapSelectionToMappingMode(region: PatternRegion): number {
  const mode = region.mappingMode ?? region.selectionType
  return mode === 'part' ? MODE_CUBIC : MODE_TRIPLANAR
}

export function buildRegularizeOpts(): RegularizeOpts {
  return {
    aspectThreshold: 5,
    slack: 3.0,
    aggressiveSlack: 8.0,
    extremeSliverAspect: 8,
    maxNormalDeltaCos: Math.cos((15 * Math.PI) / 180),
    aggressiveNormalDeltaCos: Math.cos((25 * Math.PI) / 180),
  }
}

export function buildEngineSettings(
  region: PatternRegion,
  quality: ExportQuality,
  modelRoot: Object3D,
  exportUnitScale: number,
): EngineSettings {
  const cfg = EXPORT_QUALITY[quality]
  const modelMaxDim = getModelMaxDimension(modelRoot)
  const depthWorld = depthLevelToDisplacementWorld(region.settings.depth, modelMaxDim) * exportUnitScale
  const settings = region.settings

  return {
    mappingMode: mapSelectionToMappingMode(region),
    scaleU: Math.max(0.05, settings.scale * 0.5),
    scaleV: Math.max(0.05, settings.scale * 0.5),
    amplitude: Math.max(depthWorld, 1e-6),
    offsetU: settings.offsetX,
    offsetV: settings.offsetY,
    rotation: settings.rotation,
    refineLength: cfg.fineEdgeLengthMm,
    maxTriangles: getExportOutputTriangles(quality),
    bottomAngleLimit: 5,
    topAngleLimit: 0,
    smoothBottom: true,
    harvestFlatFaces: true,
    harvestTol: 0.005,
    regularizeEnabled: true,
    regularizeSecondPassMul: 1.1,
    boundaryFalloff: 0,
    invertDisplacement: false,
    symmetricDisplacement: settings.symmetric,
  }
}
