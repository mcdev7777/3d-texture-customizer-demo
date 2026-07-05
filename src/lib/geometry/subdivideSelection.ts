import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  type BufferAttribute,
} from 'three'

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

function midpoint(pos: BufferAttribute, a: number, b: number, target: Vector3): Vector3 {
  return target.set(
    (pos.getX(a) + pos.getX(b)) * 0.5,
    (pos.getY(a) + pos.getY(b)) * 0.5,
    (pos.getZ(a) + pos.getZ(b)) * 0.5,
  )
}

export interface SubdivideResult {
  geometry: BufferGeometry
  pristineTriMap: number[]
}

export function subdivideSelectedTrianglesOnce(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  pristineWorld?: Float32Array | null,
  inputPristineTriMap?: number[],
): SubdivideResult {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) throw new Error('Geometry must be indexed for subdivision.')

  const triCount = index.count / 3
  const pristineTriMap = inputPristineTriMap ?? Array.from({ length: triCount }, (_, i) => i)

  const newPositions: number[] = []
  for (let i = 0; i < pos.count; i++) {
    newPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  }

  const newPristineWorld: number[] = []
  if (pristineWorld) {
    for (let i = 0; i < pos.count; i++) {
      const o = i * 3
      newPristineWorld.push(pristineWorld[o]!, pristineWorld[o + 1]!, pristineWorld[o + 2]!)
    }
  }

  const edgeMid = new Map<string, number>()
  const mid = new Vector3()
  const newIndices: number[] = []
  const newTriMap: number[] = []

  const getMid = (a: number, b: number): number => {
    const key = edgeKey(a, b)
    let vi = edgeMid.get(key)
    if (vi !== undefined) return vi

    midpoint(pos, a, b, mid)
    vi = newPositions.length / 3
    newPositions.push(mid.x, mid.y, mid.z)

    if (pristineWorld) {
      const oa = a * 3
      const ob = b * 3
      newPristineWorld.push(
        (pristineWorld[oa]! + pristineWorld[ob]!) * 0.5,
        (pristineWorld[oa + 1]! + pristineWorld[ob + 1]!) * 0.5,
        (pristineWorld[oa + 2]! + pristineWorld[ob + 2]!) * 0.5,
      )
    }

    edgeMid.set(key, vi)
    return vi
  }

  const pushTri = (a: number, b: number, c: number, pristineTri: number) => {
    newIndices.push(a, b, c)
    newTriMap.push(pristineTri)
  }

  for (let t = 0; t < triCount; t++) {
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    const pTri = pristineTriMap[t] ?? t

    if (!selectedTriangles.has(t)) {
      pushTri(ia, ib, ic, pTri)
      continue
    }

    const mab = getMid(ia, ib)
    const mbc = getMid(ib, ic)
    const mca = getMid(ic, ia)
    pushTri(ia, mab, mca, pTri)
    pushTri(mab, ib, mbc, pTri)
    pushTri(mca, mbc, ic, pTri)
    pushTri(mab, mbc, mca, pTri)
  }

  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  out.setIndex(newIndices)
  if (newPristineWorld.length > 0) {
    out.setAttribute('pristineWorld', new Float32BufferAttribute(newPristineWorld, 3))
  }
  out.computeVertexNormals()
  return { geometry: out, pristineTriMap: newTriMap }
}

export function currentTrianglesForPristineSelection(
  pristineTriMap: number[],
  pristineSelection: Set<number>,
): Set<number> {
  const result = new Set<number>()
  for (let t = 0; t < pristineTriMap.length; t++) {
    if (pristineSelection.has(pristineTriMap[t]!)) result.add(t)
  }
  return result
}

const MAX_SUBDIV_LEVELS = 3
const MAX_TRIANGLES = 120_000

export function subdivisionLevelsForQuality(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  quality: 'preview' | 'apply',
): number {
  const index = geometry.index
  if (!index) return 0
  const triCount = index.count / 3
  const selCount = selectedTriangles.size

  if (quality === 'preview') {
    if (triCount <= 24) return 1
    return 0
  }

  let levels = 0
  if (triCount <= 12) levels = 3
  else if (triCount <= 48) levels = 2
  else if (triCount <= 256) levels = 1

  const estimated = selCount * Math.pow(4, levels)
  while (levels > 0 && estimated > MAX_TRIANGLES) levels--
  return Math.min(levels, MAX_SUBDIV_LEVELS)
}

export function subdivideSelectedTriangles(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  levels: number,
  pristineWorld?: Float32Array | null,
  pristineSelection?: Set<number>,
): SubdivideResult {
  let geo = geometry
  let pw: Float32Array | null = pristineWorld ?? null
  let triMap = Array.from({ length: (geo.index?.count ?? 0) / 3 }, (_, i) => i)
  let sel = selectedTriangles

  const n = Math.max(0, Math.min(levels, MAX_SUBDIV_LEVELS))
  for (let i = 0; i < n; i++) {
    const next = subdivideSelectedTrianglesOnce(geo, sel, pw, triMap)
    if (geo !== geometry) geo.dispose()
    geo = next.geometry
    triMap = next.pristineTriMap
    pw = (geo.getAttribute('pristineWorld')?.array as Float32Array | undefined) ?? pw
    if (pristineSelection) {
      sel = currentTrianglesForPristineSelection(triMap, pristineSelection)
    }
  }

  return { geometry: geo, pristineTriMap: triMap }
}
