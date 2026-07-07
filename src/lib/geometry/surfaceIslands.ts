import { BufferGeometry, Mesh, Vector3 } from 'three'
import { computeFaceNormal } from '../surface/computeFaceNormal'
import { getConnectedCoplanarSurface } from '../surface/getConnectedCoplanarSurface'

const _faceN = new Vector3()
const _pw = new Vector3()

export interface SurfaceIsland {
  id: string
  faceIds: number[]
  normal: Vector3
  anchor: Vector3
}

/** Group selected triangles into coplanar islands (cube faces stay separate). */
export function buildSurfaceIslands(
  geometry: BufferGeometry,
  mesh: Mesh,
  triangleIndices: readonly number[],
  angleThresholdDeg: number,
  idPrefix: string,
): SurfaceIsland[] {
  const remaining = new Set(triangleIndices)
  const islands: SurfaceIsland[] = []
  let islandIndex = 0

  while (remaining.size > 0) {
    const seed = remaining.values().next().value!
    const connected = getConnectedCoplanarSurface(geometry, mesh, seed, angleThresholdDeg)
    const faceIds = connected.filter((t) => remaining.has(t))
    if (faceIds.length === 0) {
      remaining.delete(seed)
      continue
    }
    for (const t of faceIds) remaining.delete(t)

    const { normal, anchor } = computeIslandBasis(geometry, mesh, faceIds)
    islands.push({
      id: `${idPrefix}:${islandIndex++}`,
      faceIds,
      normal,
      anchor,
    })
  }

  return islands
}

export function computeIslandBasis(
  geometry: BufferGeometry,
  mesh: Mesh,
  faceIds: readonly number[],
): { normal: Vector3; anchor: Vector3 } {
  mesh.updateWorldMatrix(true, false)
  const matrixWorld = mesh.matrixWorld

  const normal = new Vector3()
  for (const f of faceIds) {
    computeFaceNormal(geometry, f, mesh, _faceN)
    normal.add(_faceN)
  }
  if (faceIds.length > 0) normal.divideScalar(faceIds.length).normalize()
  else normal.set(0, 0, 1)

  const anchor = new Vector3()
  const pos = geometry.getAttribute('position')
  const index = geometry.index
  if (!pos || !index) return { normal, anchor }

  let count = 0
  for (const f of faceIds) {
    for (let c = 0; c < 3; c++) {
      const vi = index.getX(f * 3 + c)
      _pw.fromBufferAttribute(pos, vi).applyMatrix4(matrixWorld)
      anchor.add(_pw)
      count++
    }
  }
  if (count > 0) anchor.divideScalar(count)

  return { normal, anchor }
}
