import type { BufferGeometry, Mesh } from 'three'
import { getTriangleVertexIndices } from './computeFaceNormal'
import { getTriangleCount } from './geometryKeys'

function sortedVertexKey(a: number, b: number, c: number): string {
  const sorted = [a, b, c].sort((x, y) => x - y)
  return `${sorted[0]},${sorted[1]},${sorted[2]}`
}

function buildVertexTripleLookup(geometry: BufferGeometry): Map<string, number> {
  const map = new Map<string, number>()
  const triCount = getTriangleCount(geometry)
  for (let t = 0; t < triCount; t++) {
    const [ia, ib, ic] = getTriangleVertexIndices(geometry, t)
    const key = sortedVertexKey(ia, ib, ic)
    if (!map.has(key)) map.set(key, t)
  }
  return map
}

/** Map a triangle index on the live mesh to the matching triangle on pristine geometry. */
export function mapLiveFaceIndexToPristine(
  mesh: Mesh,
  pristineGeometry: BufferGeometry,
  liveFaceIndex: number,
): number {
  const [ia, ib, ic] = getTriangleVertexIndices(mesh.geometry, liveFaceIndex)
  const key = sortedVertexKey(ia, ib, ic)
  const lookup = buildVertexTripleLookup(pristineGeometry)
  return lookup.get(key) ?? liveFaceIndex
}
