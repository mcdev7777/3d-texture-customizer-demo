import type { Object3D } from 'three'
import type { ExportQuality } from '../../../types/bake'
import type { PatternRegion } from '../../materials/patternMaterialApply'
import {
  computeReliefEdgeTargets,
  getExportOutputTriangles,
} from '../../geometry/subdivideSelection'
import { depthLevelToDisplacementWorld, getModelMaxDimension } from '../../pattern/patternDepth'
import type { EngineBounds, EngineSettings, RegularizeOpts } from '../exportPipeline'
import { clampEdgeToTriangleBudget } from './subdivisionEstimate'

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

// Pre-decimation triangle-count budget, as a multiple of the quality's final
// output-triangle target — bounds decimate()'s work regardless of how fine a
// pattern's feature size implies the edge should be (e.g. hex/grid/diamond,
// whose small featureRadius can still demand a sub-0.15mm edge on an
// ordinary-sized model). 8x gives decimate() enough material to preserve
// detail without letting a single fine pattern blow subdivision up to
// millions of triangles; capped at BumpMesh's own "Smart" recommendation
// ceiling (2M) as an absolute backstop.
const SUBDIVISION_BUDGET_MULTIPLIER = 8
const SUBDIVISION_BUDGET_CEILING = 2_000_000

/**
 * Feature-size-adaptive subdivision edge length, in mm — mirrors
 * `computeReliefEdgeTargets`'s pattern-aware branch (used by the STL/OBJ/GLB
 * bake path), instead of a flat per-quality mm constant, then clamped to a
 * triangle-count budget the same way BumpMesh's own Smart Resolution does.
 *
 * The flat constant (e.g. 0.021mm at "high") was sized for some reference
 * print scale and ignores both the model's real-world size and the pattern's
 * configured scale/cell density. On a normal-sized model it forces subdivision
 * to run away toward its OOM safety cap (16-32M triangles) regardless of how
 * coarse the actual pattern feature is, and `decimate()` then has to crush
 * that back down to the quality's output-triangle target (70k-500k) — an
 * extremely expensive reduction that reads as a near-permanent stall on the
 * "Decimating mesh" progress step. Sizing the edge to the pattern's real
 * physical feature size (as the sibling bake path already does) fixes that
 * for most patterns, but a fine-detail pattern (small featureRadius) can
 * still imply a very small edge on its own — so the result is additionally
 * clamped so subdivide()'s predicted output never exceeds a bounded budget.
 */
function computeAdaptiveRefineLengthMm(
  quality: ExportQuality,
  region: PatternRegion,
  bounds: EngineBounds,
  positions: Float32Array,
): number {
  const maxDimMm = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6)
  const { fineEdge } = computeReliefEdgeTargets(quality, 1, {
    patternId: region.settings.patternId,
    scale: region.settings.scale,
    projection: { width: maxDimMm, height: maxDimMm },
  })
  const triBudget = Math.min(
    getExportOutputTriangles(quality) * SUBDIVISION_BUDGET_MULTIPLIER,
    SUBDIVISION_BUDGET_CEILING,
  )
  return clampEdgeToTriangleBudget(positions, fineEdge, triBudget)
}

export function buildEngineSettings(
  region: PatternRegion,
  quality: ExportQuality,
  modelRoot: Object3D,
  exportUnitScale: number,
  bounds: EngineBounds,
  positions: Float32Array,
): EngineSettings {
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
    refineLength: computeAdaptiveRefineLengthMm(quality, region, bounds, positions),
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
    // BumpMesh's own defaults (main.js) — previously omitted here, which left
    // cubic mapping's mode.js/displacement.js reading their `?? 0` fallbacks:
    // a hard, unblended one-hot axis cutoff with an unsmoothed per-vertex
    // blend normal. On flat/box-like models the dominant axis rarely changes
    // across a selection, so it went unnoticed; on complex curved geometry
    // (fillets, rounded transitions — "part" selections use MODE_CUBIC) it
    // produces visible seams where the dominant axis flips and stretching as
    // the projection approaches grazing angle right up to that hard cut.
    mappingBlend: 1,
    seamBandWidth: 0.5,
    blendNormalSmoothing: 32,
  }
}
