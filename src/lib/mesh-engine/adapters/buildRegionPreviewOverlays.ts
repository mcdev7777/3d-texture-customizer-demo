import type { Material, Mesh, Object3D } from 'three'
import { BufferGeometry } from 'three'
import type { ExportQuality } from '../../../types/bake'
import type { SurfacePatternPlacement } from '../../../types/pattern'
import { collectAllExportRegionsForMesh } from '../../materials/patternMaterialApply'
import { depthLevelToDisplacementWorld } from '../../pattern/patternDepth'
import {
  createPatternPreviewMaterial,
  makeDisplacementDataTexture,
} from '../../materials/patternPreviewShaderMaterial'
import type { EngineBounds } from '../exportPipeline'
import { buildLayerSettings } from './engineSettings'
import { buildDisplacementTexture } from './engineTexture'
import { collectMeshTriangleSoup } from './collectMeshPositions'
import { buildRegionPreviewGeometry } from './buildRegionPreviewGeometry'

export interface PreviewOverlaySpec {
  geometry: BufferGeometry
  material: Material
}

/** World-space AABB of a region's triangles, in the soup's units. */
function regionSoupBounds(
  positions: Float32Array,
  triangleIndices: readonly number[],
): EngineBounds | undefined {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const triCount = positions.length / 9
  for (const t of triangleIndices) {
    if (t < 0 || t >= triCount) continue
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3
      const x = positions[o]!, y = positions[o + 1]!, z = positions[o + 2]!
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }
  if (!Number.isFinite(minX)) return undefined
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
  }
}

function sharedBoundsToEngineBounds(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  scale: number,
): EngineBounds {
  const mn = { x: min.x * scale, y: min.y * scale, z: min.z * scale }
  const mx = { x: max.x * scale, y: max.y * scale, z: max.z * scale }
  return {
    min: mn,
    max: mx,
    size: { x: mx.x - mn.x, y: mx.y - mn.y, z: mx.z - mn.z },
    center: { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 },
  }
}

/**
 * Fast, synchronous equivalent of {@link bakeMeshRegions} for the live 3D
 * preview: builds one GPU-shaded overlay per patterned region instead of
 * running the CPU subdivide/displace/decimate pipeline. Each overlay's shader
 * projects and bump-shades the pattern exactly the way the export bake does
 * (shared mapping math), so the preview matches the print without the
 * multi-second pipeline cost. See patternPreviewShaderMaterial.ts.
 *
 * `soupScale` mirrors bakeMeshRegions: pass 1 for viewer-normalized space
 * (live preview). `useDisplacement` physically moves vertices (only looks good
 * on already-dense meshes); default false gives BumpMesh's fast bump-only look.
 */
export function buildRegionPreviewOverlays(
  mesh: Mesh,
  root: Object3D,
  placements: Record<string, SurfacePatternPlacement>,
  committedSurfaceIds: readonly string[],
  quality: ExportQuality,
  exportUnitScale: number,
  soupScale: number,
  sourceMaterial: Material,
  previewSurfaceIds: readonly string[] = [],
  useDisplacement = true,
): PreviewOverlaySpec[] {
  const regions = collectAllExportRegionsForMesh(
    mesh,
    root,
    placements,
    committedSurfaceIds,
    previewSurfaceIds,
  )
  const patternedRegions = regions.filter((r) => r.settings.patternId)
  if (patternedRegions.length === 0) return []

  const { positions } = collectMeshTriangleSoup(mesh, soupScale)
  const mmPerPositionUnit = exportUnitScale / Math.max(soupScale, 1e-9)

  const specs: PreviewOverlaySpec[] = []
  for (const region of patternedRegions) {
    if (region.triangleIndices.length === 0) continue

    const texture = buildDisplacementTexture(region.settings.patternId!, region.settings, quality)
    const magnitude = depthLevelToDisplacementWorld(region.settings.depth, mmPerPositionUnit)
    const amplitude = region.settings.mode === 'engrave' ? -magnitude : magnitude
    const settings = buildLayerSettings(region, amplitude, soupScale)

    const bounds = region.sharedBoundsWorld
      ? sharedBoundsToEngineBounds(region.sharedBoundsWorld.min, region.sharedBoundsWorld.max, soupScale)
      : regionSoupBounds(positions, region.triangleIndices)
    if (!bounds) continue

    const tmax = Math.max(texture.width, texture.height, 1)
    // Tessellate finely enough that vertex displacement resolves the pattern's
    // relief. Density is relative to the region's extent (finer patterns pack
    // more tiles, but the geometry builder's triangle budget caps the total).
    const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6)
    const targetEdge = maxDim / 350
    const geometry = buildRegionPreviewGeometry(positions, region.triangleIndices, targetEdge)
    const material = createPatternPreviewMaterial({
      sourceMaterial,
      settings,
      amplitude: settings.amplitude,
      bounds,
      texture: makeDisplacementDataTexture(texture.imageData),
      textureAspectU: tmax / Math.max(texture.width, 1),
      textureAspectV: tmax / Math.max(texture.height, 1),
      // Physically move vertices so the preview has real height/silhouette —
      // bump-only shading alone reads as flat on a coarse mesh.
      useDisplacement,
    })
    specs.push({ geometry, material })
  }

  return specs
}
