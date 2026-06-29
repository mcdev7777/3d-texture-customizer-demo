import { Vector3 } from 'three'
import type { BufferGeometry, Mesh } from 'three'
import { getTriangleVertexIndices } from './computeFaceNormal'

const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()
const _cb = new Vector3()
const _ab = new Vector3()

export function computeTriangleAreaLocal(geometry: BufferGeometry, faceIndex: number): number {
  const position = geometry.getAttribute('position')
  const [ia, ib, ic] = getTriangleVertexIndices(geometry, faceIndex)

  _vA.fromBufferAttribute(position, ia)
  _vB.fromBufferAttribute(position, ib)
  _vC.fromBufferAttribute(position, ic)

  _cb.subVectors(_vC, _vB)
  _ab.subVectors(_vA, _vB)
  return _cb.cross(_ab).length() * 0.5
}

export function computeTriangleAreaWorld(
  geometry: BufferGeometry,
  faceIndex: number,
  mesh: Mesh,
): number {
  const position = geometry.getAttribute('position')
  const [ia, ib, ic] = getTriangleVertexIndices(geometry, faceIndex)

  mesh.updateWorldMatrix(true, false)

  _vA.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld)
  _vB.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld)
  _vC.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld)

  _cb.subVectors(_vC, _vB)
  _ab.subVectors(_vA, _vB)
  return _cb.cross(_ab).length() * 0.5
}

export function computeSurfaceArea(
  geometry: BufferGeometry,
  mesh: Mesh,
  triangleIndices: readonly number[],
): number {
  let area = 0
  for (const faceIndex of triangleIndices) {
    area += computeTriangleAreaWorld(geometry, faceIndex, mesh)
  }
  return area
}
