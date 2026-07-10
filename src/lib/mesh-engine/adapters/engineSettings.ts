import type { ExportQuality } from '../../../types/bake'
import { patternScaleU, patternScaleV } from '../../../types/pattern'
import type { PatternRegion } from '../../materials/patternMaterialApply'
import {
  computeReliefEdgeTargets,
  getExportOutputTriangles,
} from '../../geometry/subdivideSelection'
import type {
  EngineBounds,
  EngineLayerSettings,
  EngineSettings,
  RegularizeOpts,
} from '../exportPipeline'
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
const SUBDIVISION_BUDGET_CEILING = 20_000_000

/**
 * Feature-size-adaptive subdivision edge length, in mm — mirrors
 * `computeReliefEdgeTargets`'s pattern-aware branch (used by the STL/OBJ/GLB
 * bake path), instead of a flat per-quality mm constant.
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
 * for most patterns.
 */
function rawFineEdgeMm(quality: ExportQuality, region: PatternRegion, bounds: EngineBounds): number {
  const maxDimMm = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6)
  const { fineEdge } = computeReliefEdgeTargets(quality, 1, {
    patternId: region.settings.patternId,
    // Finest of the two axes drives subdivision so both directions get enough
    // triangles for the smaller-tiled (higher-repeat) axis.
    scale: Math.min(patternScaleU(region.settings), patternScaleV(region.settings)),
    projection: { width: maxDimMm, height: maxDimMm },
  })
  return fineEdge
}

/**
 * Per-region displacement pass settings (texture mapping/amplitude —
 * everything BUT the shared pipeline knobs).
 *
 * `amplitude` is in whatever linear unit the pipeline's `positions` soup is
 * in (mm for a real export, viewer-normalized units for an in-app 3D
 * preview bake) — callers convert the mm-native depth value via
 * `depthLevelToDisplacementMm` (export) or `depthLevelToDisplacementWorld`
 * (viewer space) before calling this.
 */
export function buildLayerSettings(region: PatternRegion, amplitude: number): EngineLayerSettings {
  const settings = region.settings

  // "Scale" is a tile-size multiplier: scale 1 = one tile fills the
  // selection; scale 0.5 = each tile is half-size, so a 2x2 = 4 tiles fill
  // the selection instead; scale 2 = each tile is twice the selection size
  // (zoomed in on part of one tile). BumpMesh's mapping.js already divides
  // (uu = u / scaleU), so passing scale straight through as scaleU gives
  // exactly that: repeats-across-selection = 1/scaleU = 1/scale. This must
  // stay the same convention the live preview shader uses (patternShaderMaterial.ts
  // divides pu by patternRepeatScale for the same reason) so 2D preview and
  // 3D/export show the same tiling for the same scale value.
  const scaleU = Math.max(0.05, patternScaleU(settings))
  const scaleV = Math.max(0.05, patternScaleV(settings))

  return {
    mappingMode: mapSelectionToMappingMode(region),
    scaleU,
    scaleV,
    // Preserve sign (engrave passes a negative amplitude to carve inward);
    // only clamp the magnitude away from zero.
    amplitude: Math.sign(amplitude || 1) * Math.max(Math.abs(amplitude), 1e-6),
    offsetU: settings.offsetX,
    offsetV: settings.offsetY,
    rotation: settings.rotation,
    invertDisplacement: false,
    symmetricDisplacement: settings.symmetric,
    // BumpMesh's own defaults (main.js) — previously omitted here, which left
    // cubic mapping's mapping.js/displacement.js reading their `?? 0` fallbacks:
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

/**
 * Pipeline-global settings shared by every region on a mesh: the single
 * subdivision edge length (finest of all regions' feature-size targets,
 * then clamped to a triangle budget over the WHOLE mesh so N regions can't
 * multiply subdivision cost), decimation target, and bottom/repair knobs.
 */
export function buildPipelineSettings(
  regions: readonly PatternRegion[],
  quality: ExportQuality,
  bounds: EngineBounds,
  positions: Float32Array,
): EngineSettings {
  const finestRawEdge = Math.min(...regions.map((r) => rawFineEdgeMm(quality, r, bounds)))
  const triBudget = Math.min(
    getExportOutputTriangles(quality) * SUBDIVISION_BUDGET_MULTIPLIER,
    SUBDIVISION_BUDGET_CEILING,
  )
  const refineLength = clampEdgeToTriangleBudget(positions, finestRawEdge, triBudget)

  // Whole-part selections want the pattern on every surface, including the
  // underside — the bottomAngleLimit/smoothBottom print-bed-flatness
  // protection (masks displacement near-flat-downward faces during
  // applyDisplacement, then re-flattens anything left near the mesh's global
  // min Z via clampBelowBottom/snapBottomToFlat) exists to keep a
  // face/triangle-brush selection's bed-contact face flat, but it silently
  // erases relief on a part selection's bottom surface, which reads as "the
  // pattern doesn't apply to the bottom". Disable it whenever any region in
  // this export is a full-part selection.
  const hasPartSelection = regions.some((r) => r.selectionType === 'part')

  // The displacement-only fields below (mappingMode..blendNormalSmoothing)
  // are dead weight here: the multi-layer pipeline path reads amplitude/
  // mapping/etc. from each `layers[i].settings` (buildLayerSettings), never
  // from this shared object — only refineLength/maxTriangles/regularize*/
  // bottom*/harvest* are read off `settings` once layers are present. Filled
  // with neutral placeholders purely to satisfy the EngineSettings shape
  // (also the single-layer/bake contract, where they matter).
  return {
    mappingMode: MODE_TRIPLANAR,
    scaleU: 1,
    scaleV: 1,
    amplitude: 0,
    offsetU: 0,
    offsetV: 0,
    rotation: 0,
    invertDisplacement: false,
    symmetricDisplacement: false,
    mappingBlend: 1,
    seamBandWidth: 0.5,
    blendNormalSmoothing: 32,
    refineLength,
    maxTriangles: getExportOutputTriangles(quality),
    bottomAngleLimit: hasPartSelection ? 0 : 5,
    topAngleLimit: 0,
    smoothBottom: !hasPartSelection,
    harvestFlatFaces: true,
    harvestTol: 0.005,
    regularizeEnabled: true,
    regularizeSecondPassMul: 1.1,
    boundaryFalloff: 0,
  }
}
