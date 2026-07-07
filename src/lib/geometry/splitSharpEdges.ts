import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Triangle,
  Vector3,
} from 'three'
import { getTriangleVertexIndices } from '../surface/computeFaceNormal'

const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()
const _faceN = new Vector3()

function computeLocalFaceNormals(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute('position') as BufferAttribute
  const triCount = geometry.index
    ? geometry.index.count / 3
    : position.count / 3
  const normals: Vector3[] = []

  for (let t = 0; t < triCount; t++) {
    const [ia, ib, ic] = getTriangleVertexIndices(geometry, t)
    _vA.fromBufferAttribute(position, ia)
    _vB.fromBufferAttribute(position, ib)
    _vC.fromBufferAttribute(position, ic)
    Triangle.getNormal(_vA, _vB, _vC, _faceN)
    if (_faceN.lengthSq() < 1e-12) _faceN.set(0, 0, 1)
    normals.push(_faceN.clone().normalize())
  }

  return normals
}

function normalKey(normal: Vector3): string {
  return `${normal.x.toFixed(4)}|${normal.y.toFixed(4)}|${normal.z.toFixed(4)}`
}

/**
 * Duplicate vertices along sharp edges so displacement normals do not bleed across
 * faces (e.g. cube corners). Coplanar adjacent triangles keep shared vertices.
 */
export function splitVerticesAlongSharpEdges(
  geometry: BufferGeometry,
  _sharpAngleDeg = 30,
): BufferGeometry {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index || !pos) return geometry.clone()

  const triCount = index.count / 3
  const faceNormals = computeLocalFaceNormals(geometry)
  const cornerToVert = new Map<string, number>()
  const newPositions: number[] = []
  const newIndices: number[] = []

  for (let t = 0; t < triCount; t++) {
    const fn = faceNormals[t]!
    const nk = normalKey(fn)
    for (let c = 0; c < 3; c++) {
      const vi = index.getX(t * 3 + c)
      const key = `${vi}|${nk}`
      let newVi = cornerToVert.get(key)
      if (newVi === undefined) {
        newVi = newPositions.length / 3
        newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
        cornerToVert.set(key, newVi)
      }
      newIndices.push(newVi)
    }
  }

  const result = geometry.clone()
  result.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  result.setIndex(newIndices)
  result.computeVertexNormals()
  return result
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/**
 * Split vertices along the border between patterned and unpatterned triangles so
 * displacement does not tear adjacent faces.
 */
export function splitVerticesAlongPatchBoundary(
  geometry: BufferGeometry,
  patchTriangles: ReadonlySet<number>,
): BufferGeometry {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index || !pos || patchTriangles.size === 0) return geometry.clone()

  const triCount = index.count / 3
  const edgeTris = new Map<string, number[]>()

  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = index.getX(t * 3 + e)
      const b = index.getX(t * 3 + ((e + 1) % 3))
      const key = edgeKey(a, b)
      const list = edgeTris.get(key)
      if (list) list.push(t)
      else edgeTris.set(key, [t])
    }
  }

  const boundaryEdges = new Set<string>()
  for (const [key, tris] of edgeTris) {
    let hasPatch = false
    let hasBase = false
    for (const t of tris) {
      if (patchTriangles.has(t)) hasPatch = true
      else hasBase = true
    }
    if (hasPatch && hasBase) boundaryEdges.add(key)
  }

  const cornerToVert = new Map<string, number>()
  const newPositions: number[] = []
  const newIndices: number[] = []

  const cornerKey = (t: number, c: number, vi: number): string => {
    const prev = index.getX(t * 3 + ((c + 2) % 3))
    const next = index.getX(t * 3 + ((c + 1) % 3))
    const onBoundary =
      boundaryEdges.has(edgeKey(vi, prev)) || boundaryEdges.has(edgeKey(vi, next))
    return onBoundary ? `b:${t}:${c}:${vi}` : `i:${vi}`
  }

  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = index.getX(t * 3 + c)
      const key = cornerKey(t, c, vi)
      let newVi = cornerToVert.get(key)
      if (newVi === undefined) {
        newVi = newPositions.length / 3
        newPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
        cornerToVert.set(key, newVi)
      }
      newIndices.push(newVi)
    }
  }

  const result = geometry.clone()
  result.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  result.setIndex(newIndices)
  result.computeVertexNormals()
  return result
}
