import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three'
import { getTriangleVertexIndices } from './computeFaceNormal'

const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()
const _edge1 = new Vector3()
const _edge2 = new Vector3()
const _normal = new Vector3()
const _offset = new Vector3()
const _box = new Box3()
const _size = new Vector3()

function computeSurfaceOffset(modelRoot: Object3D | null): number {
  if (!modelRoot) return 0.004
  _box.setFromObject(modelRoot)
  if (_box.isEmpty()) return 0.004
  _box.getSize(_size)
  return Math.max(_size.length() * 0.0006, 0.002)
}

export function buildSelectedSurfaceGeometry(
  sourceGeometry: BufferGeometry,
  mesh: Mesh,
  triangleIndices: readonly number[],
  modelRoot: Object3D | null,
): BufferGeometry {
  const geometry = new BufferGeometry()
  const position = sourceGeometry.getAttribute('position')
  const positions: number[] = []
  const normals: number[] = []

  mesh.updateWorldMatrix(true, false)
  const surfaceOffset = computeSurfaceOffset(modelRoot)

  for (const faceIndex of triangleIndices) {
    const [ia, ib, ic] = getTriangleVertexIndices(sourceGeometry, faceIndex)

    _vA.fromBufferAttribute(position, ia)
    _vB.fromBufferAttribute(position, ib)
    _vC.fromBufferAttribute(position, ic)

    _vA.applyMatrix4(mesh.matrixWorld)
    _vB.applyMatrix4(mesh.matrixWorld)
    _vC.applyMatrix4(mesh.matrixWorld)

    _edge1.subVectors(_vB, _vA)
    _edge2.subVectors(_vC, _vA)
    _normal.crossVectors(_edge1, _edge2)
    if (_normal.lengthSq() === 0) continue
    _normal.normalize()
    _offset.copy(_normal).multiplyScalar(surfaceOffset)

    for (const v of [_vA, _vB, _vC]) {
      positions.push(v.x + _offset.x, v.y + _offset.y, v.z + _offset.z)
      normals.push(_normal.x, _normal.y, _normal.z)
    }
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  return geometry
}

export function formatNormal(normal: Vector3): string {
  return `${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}`
}

export function formatArea(area: number): string {
  if (area < 0.001) return area.toExponential(2)
  return area.toFixed(4)
}
