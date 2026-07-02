import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'
import type { SelectionMode } from '../../types/surfaceSelection'
import {
  createSurfaceProjectionFromHighlight,
  type SurfaceProjection,
} from './surfaceProjection'

/**
 * A single mappable region of the current selection. Surface selections yield
 * one target; part selections yield one target per planar island (top, side,
 * front, …) so each face is mapped correctly instead of one skewed rectangle.
 */
export interface TextureTarget {
  /** World-space triangle vertices, flat: [ax,ay,az, bx,by,bz, cx,cy,cz, …]. */
  triangles: number[]
  /** World-space per-triangle normals, flat: [nx,ny,nz, …] (one per triangle). */
  triangleNormals: number[]
  /** In-plane frame + bounds used to map pattern UVs consistently. */
  projection: SurfaceProjection
}

/** Angle tolerance (degrees) for grouping a part's faces into planar islands. */
export const ISLAND_ANGLE_TOLERANCE = 20
const MAX_ISLANDS = 32

interface IslandAccumulator {
  normal: Vector3
  triangles: number[]
  triangleNormals: number[]
}

/**
 * Build texture targets from the world-space highlight geometry of the current
 * selection (positions + per-face normals). Surface selections stay a single
 * target; part selections are clustered into planar islands.
 */
export function buildTextureTargets(
  highlightGeometry: BufferGeometry,
  seedNormal: Vector3,
  fallbackCenter: Vector3 | undefined,
  selectionType: SelectionMode,
): TextureTarget[] {
  const position = highlightGeometry.getAttribute('position')
  const normal = highlightGeometry.getAttribute('normal')
  if (!position || position.count < 3) return []

  const triangleCount = Math.floor(position.count / 3)

  const readTriangle = (t: number): { verts: number[]; n: Vector3 } => {
    const verts: number[] = []
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k
      verts.push(position.getX(i), position.getY(i), position.getZ(i))
    }
    const n = new Vector3()
    if (normal) {
      n.set(normal.getX(t * 3), normal.getY(t * 3), normal.getZ(t * 3))
    }
    if (n.lengthSq() === 0) n.copy(seedNormal)
    n.normalize()
    return { verts, n }
  }

  // Surface selection → one island containing every selected triangle.
  if (selectionType === 'surface') {
    const triangles: number[] = []
    const triangleNormals: number[] = []
    for (let t = 0; t < triangleCount; t++) {
      const { verts, n } = readTriangle(t)
      triangles.push(...verts)
      triangleNormals.push(n.x, n.y, n.z)
    }
    const projection = createSurfaceProjectionFromHighlight(
      highlightGeometry,
      seedNormal,
      fallbackCenter,
    )
    return [{ triangles, triangleNormals, projection }]
  }

  // Part selection → cluster triangles into planar islands by normal.
  const cosThreshold = Math.cos((ISLAND_ANGLE_TOLERANCE * Math.PI) / 180)
  const islands: IslandAccumulator[] = []

  for (let t = 0; t < triangleCount; t++) {
    const { verts, n } = readTriangle(t)
    let island = findIsland(islands, n, cosThreshold)
    if (!island) {
      island = islands.length >= MAX_ISLANDS ? nearestIsland(islands, n) : addIsland(islands, n)
    }
    island.triangles.push(...verts)
    island.triangleNormals.push(n.x, n.y, n.z)
    island.normal.addScaledVector(n, 1)
  }

  const targets: TextureTarget[] = []
  for (const island of islands) {
    if (island.triangles.length < 9) continue
    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(island.triangles, 3))
    const projection = createSurfaceProjectionFromHighlight(
      geom,
      island.normal.clone().normalize(),
      fallbackCenter,
    )
    geom.dispose()
    targets.push({
      triangles: island.triangles,
      triangleNormals: island.triangleNormals,
      projection,
    })
  }
  return targets
}

function findIsland(
  islands: IslandAccumulator[],
  n: Vector3,
  cosThreshold: number,
): IslandAccumulator | null {
  for (const island of islands) {
    if (island.normal.clone().normalize().dot(n) >= cosThreshold) return island
  }
  return null
}

function nearestIsland(islands: IslandAccumulator[], n: Vector3): IslandAccumulator {
  let best = islands[0]
  let bestDot = -Infinity
  for (const island of islands) {
    const dot = island.normal.clone().normalize().dot(n)
    if (dot > bestDot) {
      bestDot = dot
      best = island
    }
  }
  return best
}

function addIsland(islands: IslandAccumulator[], n: Vector3): IslandAccumulator {
  const island: IslandAccumulator = {
    normal: n.clone(),
    triangles: [],
    triangleNormals: [],
  }
  islands.push(island)
  return island
}
