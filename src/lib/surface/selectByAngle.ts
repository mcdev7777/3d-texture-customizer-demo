import { Vector3 } from 'three'
import type { BufferGeometry, Mesh } from 'three'
import { computeFaceNormal } from './computeFaceNormal'
import { getTriangleCount } from './geometryKeys'
import { MAX_SELECTION_TRIANGLES } from '../../types/surfaceSelection'

const _normal = new Vector3()

/**
 * Select every face on the mesh whose normal is within `angleToleranceDeg`
 * of the seed face normal — ignoring connectivity. Useful for picking all
 * coplanar/parallel faces (lids, faceplates, side panels) at once.
 */
export function getFacesByAngle(
  geometry: BufferGeometry,
  mesh: Mesh,
  seedFaceIndex: number,
  angleToleranceDeg: number,
  maxTriangles = MAX_SELECTION_TRIANGLES,
): number[] {
  const triangleCount = getTriangleCount(geometry)
  if (seedFaceIndex < 0 || seedFaceIndex >= triangleCount) {
    return [Math.max(0, seedFaceIndex)]
  }

  const cosThreshold = Math.cos((angleToleranceDeg * Math.PI) / 180)
  const baseNormal = computeFaceNormal(geometry, seedFaceIndex, mesh, new Vector3())

  const result: number[] = []
  for (let face = 0; face < triangleCount && result.length < maxTriangles; face++) {
    computeFaceNormal(geometry, face, mesh, _normal)
    if (_normal.dot(baseNormal) >= cosThreshold) {
      result.push(face)
    }
  }

  return result.length > 0 ? result : [seedFaceIndex]
}

/** All faces on the mesh (capped) — used for whole-part selection. */
export function getAllMeshFaces(
  geometry: BufferGeometry,
  maxTriangles = MAX_SELECTION_TRIANGLES,
): number[] {
  const triangleCount = Math.min(getTriangleCount(geometry), maxTriangles)
  const result: number[] = new Array(triangleCount)
  for (let i = 0; i < triangleCount; i++) result[i] = i
  return result
}
