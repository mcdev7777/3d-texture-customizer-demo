import { Vector3 } from 'three'
import type { BufferGeometry, Mesh } from 'three'
import { computeFaceNormal } from './computeFaceNormal'
import { getGeometryAdjacency } from './geometryAdjacency'
import { getTriangleCount } from './geometryKeys'
import { MAX_SELECTION_TRIANGLES } from '../../types/surfaceSelection'

const _normal = new Vector3()

function normalWithinTolerance(
  geometry: BufferGeometry,
  mesh: Mesh,
  faceIndex: number,
  baseNormal: Vector3,
  cosThreshold: number,
): boolean {
  computeFaceNormal(geometry, faceIndex, mesh, _normal)
  return _normal.dot(baseNormal) >= cosThreshold
}

export function getConnectedCoplanarSurface(
  geometry: BufferGeometry,
  mesh: Mesh,
  seedFaceIndex: number,
  angleToleranceDeg: number,
  maxTriangles = MAX_SELECTION_TRIANGLES,
): number[] {
  const triangleCount = getTriangleCount(geometry)
  const { neighbors } = getGeometryAdjacency(geometry)

  if (seedFaceIndex < 0 || seedFaceIndex >= triangleCount) {
    return [Math.max(0, seedFaceIndex)]
  }

  const cosThreshold = Math.cos((angleToleranceDeg * Math.PI) / 180)

  // Chained (local) tolerance: compare each candidate face to its immediate
  // predecessor's normal rather than a single fixed seed normal. This lets
  // the flood-fill follow smoothly curving surfaces (e.g. all the way around
  // a cylindrical barrel) as one continuous region, while still stopping at
  // genuine sharp edges (e.g. where a wall meets a flat cap), since the
  // normal delta between any two adjacent faces is still checked.
  const faceNormals: Vector3[] = new Array(triangleCount)
  faceNormals[seedFaceIndex] = computeFaceNormal(geometry, seedFaceIndex, mesh, new Vector3())

  const visited = new Uint8Array(triangleCount)
  const result: number[] = []
  const queue: number[] = [seedFaceIndex]
  visited[seedFaceIndex] = 1

  while (queue.length > 0 && result.length < maxTriangles) {
    const face = queue.pop()!
    result.push(face)
    const baseNormal = faceNormals[face]

    for (const neighbor of neighbors[face]) {
      if (visited[neighbor]) continue
      if (!normalWithinTolerance(geometry, mesh, neighbor, baseNormal, cosThreshold)) {
        continue
      }
      visited[neighbor] = 1
      faceNormals[neighbor] = computeFaceNormal(geometry, neighbor, mesh, new Vector3())
      queue.push(neighbor)
    }
  }

  return result.length > 0 ? result : [seedFaceIndex]
}
