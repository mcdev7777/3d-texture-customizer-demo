import type { Mesh, Object3D, Vector3 } from 'three'
import type { ExportQuality } from '../../../types/bake'
import type { SurfacePatternPlacement } from '../../../types/pattern'
import { collectAllExportRegionsForMesh } from '../../materials/patternMaterialApply'
import { depthLevelToDisplacementWorld } from '../../pattern/patternDepth'
import { buildLayerSettings, buildPipelineSettings, buildRegularizeOpts } from './engineSettings'
import { buildDisplacementTexture } from './engineTexture'
import { buildFaceWeights, buildTriangleSet, collectCommittedTriangles } from './engineFaceMask'
import { computeEngineBounds } from './engineBounds'
import { collectMeshTriangleSoup } from './collectMeshPositions'
import { runMeshPipeline } from './runMeshPipeline'
import type { EngineBounds, EngineLayer, PipelineEventHandler, RepairStats } from '../exportPipeline'

/**
 * Converts a viewer-world-space min/max (shared across a cross-mesh "Merged"
 * pattern group — see PatternRegion.sharedBoundsWorld) into the mesh-engine's
 * plain EngineBounds shape, scaled into whatever linear unit this bake call's
 * `positions` soup is in (mm for export, viewer-normalized for 3D preview).
 */
function sharedBoundsToEngineBounds(min: Vector3, max: Vector3, positionScale: number): EngineBounds {
  const minX = min.x * positionScale
  const minY = min.y * positionScale
  const minZ = min.z * positionScale
  const maxX = max.x * positionScale
  const maxY = max.y * positionScale
  const maxZ = max.z * positionScale
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
  }
}

export interface BakeMeshRegionsResult {
  positions: Float32Array
  normals: Float32Array | null
  repairStats: RepairStats | null
}

/**
 * Bake every committed, patterned region on `mesh` into real geometry via
 * the fast worker-backed mesh-engine pipeline — the shared implementation
 * behind 3MF export, STL/OBJ/GLB export, and the in-viewer 3D Preview bake.
 *
 * `soupScale` controls what linear space the returned positions are in:
 * pass the model's real `exportUnitScale` for millimetre-space output
 * (export), or `1` for viewer-normalized-space output (live 3D preview,
 * still in the same coordinates as the rest of the loaded scene). Depth is
 * always authored in real mm regardless of `soupScale` — the mm→soupScale
 * conversion happens internally.
 *
 * Returns `{ positions: <unbaked soup>, normals: null, repairStats: null }`
 * when the mesh has no patterned regions to bake (not an error — callers
 * that just want "the mesh's geometry, patterned or not" can use this
 * directly). Returns `null` only if the pipeline was cancelled mid-flight
 * via `isStale`.
 */
export async function bakeMeshRegions(
  mesh: Mesh,
  root: Object3D,
  placements: Record<string, SurfacePatternPlacement>,
  committedSurfaceIds: readonly string[],
  quality: ExportQuality,
  exportUnitScale: number,
  soupScale: number,
  onEvent?: PipelineEventHandler,
  isStale?: () => boolean,
  previewSurfaceIds: readonly string[] = [],
  smoothnessLevel = 0,
): Promise<BakeMeshRegionsResult | null> {
  const regions = collectAllExportRegionsForMesh(
    mesh,
    root,
    placements,
    committedSurfaceIds,
    previewSurfaceIds,
  )
  const patternedRegions = regions.filter((r) => r.settings.patternId)
  const { positions, triangleCount } = collectMeshTriangleSoup(mesh, soupScale)

  if (patternedRegions.length === 0) {
    return { positions, normals: null, repairStats: null }
  }

  // mm per unit of `positions` — soupScale=exportUnitScale (export) makes
  // positions mm-native (1 unit = 1mm); soupScale=1 (viewer preview) keeps
  // positions in viewer-normalized units, where 1 unit = exportUnitScale mm.
  const mmPerPositionUnit = exportUnitScale / Math.max(soupScale, 1e-9)

  // One layer per region so each surface's own pattern gets baked instead
  // of every committed surface being stamped with a single "primary"
  // (largest) region's pattern — see engineSettings.ts buildLayerSettings.
  const layers: EngineLayer[] = patternedRegions.map((region) => {
    const texture = buildDisplacementTexture(
      region.settings.patternId!,
      region.settings,
      quality,
      smoothnessLevel,
    )
    // depthLevelToDisplacementWorld(depth, mm-per-unit) = depthMm / mm-per-unit,
    // so with mmPerPositionUnit=1 (export) this reduces to depthMm exactly.
    // Sign carries the mode: emboss = +amplitude (ink rises outward), engrave =
    // −amplitude (ink carves inward, cutting the pattern into the surface). The
    // grey texture holds only the unsigned ink intensity (see engineTexture.ts).
    const magnitude = depthLevelToDisplacementWorld(region.settings.depth, mmPerPositionUnit)
    const amplitude = region.settings.mode === 'engrave' ? -magnitude : magnitude
    return {
      triangleSet: buildTriangleSet(triangleCount, region.triangleIndices),
      imageData: texture.imageData,
      imgWidth: texture.width,
      imgHeight: texture.height,
      settings: buildLayerSettings(region, amplitude),
      bounds: region.sharedBoundsWorld
        ? sharedBoundsToEngineBounds(region.sharedBoundsWorld.min, region.sharedBoundsWorld.max, soupScale)
        : undefined,
    }
  })

  const committedTris = collectCommittedTriangles(patternedRegions.map((r) => r.triangleIndices))
  const faceWeights = buildFaceWeights(triangleCount, committedTris)
  const bounds = computeEngineBounds(positions)
  const settings = buildPipelineSettings(patternedRegions, quality, bounds, positions, smoothnessLevel)

  const result = await runMeshPipeline(
    {
      positions,
      faceWeights,
      imageData: layers[0]!.imageData,
      imgWidth: layers[0]!.imgWidth,
      imgHeight: layers[0]!.imgHeight,
      settings,
      bounds,
      regularizeOpts: buildRegularizeOpts(),
      mode: 'export',
      layers,
    },
    onEvent ?? (() => {}),
    isStale ?? (() => false),
  )

  if (!result || isStale?.()) return null

  return { positions: result.positions, normals: result.normals, repairStats: result.repairStats }
}
