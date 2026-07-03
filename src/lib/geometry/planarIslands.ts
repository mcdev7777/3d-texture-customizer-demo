import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import type { SurfacePlaneData } from '../../types/pattern'
import {
  createSurfaceProjectionFromHighlight,
  surfacePlaneFromProjection,
} from './surfaceProjection'

/** Default normal tolerance used to cluster a part's faces into planar islands. */
export const DEFAULT_ISLAND_ANGLE = 22

/** Safety cap so a highly tessellated curved part cannot spawn unbounded patches. */
const MAX_ISLANDS = 32

interface Island {
  normal: Vector3
  positions: number[]
}

/**
 * Cluster the triangles of a world-space highlight geometry into planar islands
 * (groups of faces sharing a similar normal) and return one oriented plane per
 * island.
 *
 * A single flat surface yields one plane (identical to the previous behavior).
 * A whole part yields one plane per major face orientation, so the texture wraps
 * each side correctly instead of smearing a single rectangle across corners.
 */
export function buildSurfacePlanesFromHighlight(
  highlightGeometry: BufferGeometry,
  seedNormal: Vector3,
  fallbackCenter: Vector3 | undefined,
  angleToleranceDeg = DEFAULT_ISLAND_ANGLE,
): SurfacePlaneData[] {
  const position = highlightGeometry.getAttribute('position')
  const normal = highlightGeometry.getAttribute('normal')

  // Without per-face normals we cannot cluster — fall back to a single plane.
  if (!position || !normal || position.count < 3) {
    return [singlePlane(highlightGeometry, seedNormal, fallbackCenter)]
  }

  const cosThreshold = Math.cos((angleToleranceDeg * Math.PI) / 180)
  const islands: Island[] = []
  const triangleCount = Math.floor(position.count / 3)

  const faceNormal = new Vector3()
  const vertex = new Vector3()

  for (let t = 0; t < triangleCount; t++) {
    const v0 = t * 3
    faceNormal.fromBufferAttribute(normal, v0)
    if (faceNormal.lengthSq() === 0) continue
    faceNormal.normalize()

    let target = findIsland(islands, faceNormal, cosThreshold)
    if (!target) {
      if (islands.length >= MAX_ISLANDS) {
        target = nearestIsland(islands, faceNormal)
      } else {
        target = { normal: faceNormal.clone(), positions: [] }
        islands.push(target)
      }
    }

    for (let k = 0; k < 3; k++) {
      vertex.fromBufferAttribute(position, v0 + k)
      target.positions.push(vertex.x, vertex.y, vertex.z)
      // Nudge the representative normal toward this face for a stable average.
      target.normal.addScaledVector(faceNormal, 0.001)
    }
  }

  if (islands.length === 0) {
    return [singlePlane(highlightGeometry, seedNormal, fallbackCenter)]
  }

  const planes: SurfacePlaneData[] = []
  for (const island of islands) {
    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(island.positions, 3))
    const projection = createSurfaceProjectionFromHighlight(
      geom,
      island.normal.normalize(),
      fallbackCenter,
    )
    planes.push(surfacePlaneFromProjection(projection))
    geom.dispose()
  }
  return planes
}

function findIsland(islands: Island[], faceNormal: Vector3, cosThreshold: number): Island | null {
  for (const island of islands) {
    if (island.normal.clone().normalize().dot(faceNormal) >= cosThreshold) return island
  }
  return null
}

function nearestIsland(islands: Island[], faceNormal: Vector3): Island {
  let best = islands[0]
  let bestDot = -Infinity
  for (const island of islands) {
    const dot = island.normal.clone().normalize().dot(faceNormal)
    if (dot > bestDot) {
      bestDot = dot
      best = island
    }
  }
  return best
}

function singlePlane(
  highlightGeometry: BufferGeometry,
  seedNormal: Vector3,
  fallbackCenter: Vector3 | undefined,
): SurfacePlaneData {
  const projection = createSurfaceProjectionFromHighlight(
    highlightGeometry,
    seedNormal,
    fallbackCenter,
  )
  return surfacePlaneFromProjection(projection)
}
