import { Triangle, Vector3 } from 'three'
import type { BufferGeometry, Mesh } from 'three'

const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()
const _normal = new Vector3()

export function getTriangleVertexIndices(
  geometry: BufferGeometry,
  faceIndex: number,
): [number, number, number] {
  const index = geometry.index
  if (index) {
    const i = faceIndex * 3
    return [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
  }
  const base = faceIndex * 3
  return [base, base + 1, base + 2]
}

export function computeFaceNormal(
  geometry: BufferGeometry,
  faceIndex: number,
  mesh: Mesh,
  target = new Vector3(),
): Vector3 {
  const position = geometry.getAttribute('position')
  const [ia, ib, ic] = getTriangleVertexIndices(geometry, faceIndex)

  _vA.fromBufferAttribute(position, ia)
  _vB.fromBufferAttribute(position, ib)
  _vC.fromBufferAttribute(position, ic)

  Triangle.getNormal(_vA, _vB, _vC, _normal)
  _normal.transformDirection(mesh.matrixWorld)
  return target.copy(_normal).normalize()
}
