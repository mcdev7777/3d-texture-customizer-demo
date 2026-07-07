import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  type BufferAttribute,
} from 'three'
import type { ExportQuality } from '../../types/bake'
import { yieldIfBusy } from '../export/exportProgress'

export const EXPORT_QUALITY = {
  low: {
    fineEdgeLengthMm: 0.12,
    coarseEdgeLengthMm: 0.6,
    maxTriangles: 140_000,
    outputTriangles: 70_000,
    maxIterations: 6,
    varianceThreshold: 0.05,
    textureSize: 256,
    segmentsAcrossFeature: 8,
    weldToleranceMm: 0.001,
  },
  medium: {
    fineEdgeLengthMm: 0.048,
    coarseEdgeLengthMm: 0.3,
    maxTriangles: 280_000,
    outputTriangles: 120_000,
    maxIterations: 8,
    varianceThreshold: 0.04,
    textureSize: 512,
    segmentsAcrossFeature: 15,
    weldToleranceMm: 0.001,
  },
  high: {
    fineEdgeLengthMm: 0.021,
    coarseEdgeLengthMm: 0.225,
    maxTriangles: 500_000,
    outputTriangles: 250_000,
    maxIterations: 10,
    varianceThreshold: 0.03,
    textureSize: 768,
    segmentsAcrossFeature: 27,
    weldToleranceMm: 0.001,
  },
} as const satisfies Record<
  ExportQuality,
  {
    fineEdgeLengthMm: number
    coarseEdgeLengthMm: number
    maxTriangles: number
    outputTriangles: number
    maxIterations: number
    varianceThreshold: number
    textureSize: number
    segmentsAcrossFeature: number
    weldToleranceMm: number
  }
>

export function getExportOutputTriangles(quality: ExportQuality): number {
  return EXPORT_QUALITY[quality].outputTriangles
}

/** Upper bound for relief subdivision — targets output budget directly (no decimation pass). */
export function getExportBakeTriangleCap(quality: ExportQuality): number {
  const cfg = EXPORT_QUALITY[quality]
  return Math.min(cfg.maxTriangles, Math.ceil(cfg.outputTriangles * 1.08))
}

/** Decimation is disabled — welding/decimation was breaking edges and is too slow. */
export function shouldSkipExportDecimation(
  _triangleCount: number,
  _quality: ExportQuality,
): boolean {
  return true
}

export function getExportWeldToleranceMm(quality: ExportQuality): number {
  return EXPORT_QUALITY[quality].weldToleranceMm
}

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

function assertPristineTriMapLength(triMap: number[], geometry: BufferGeometry): void {
  const triCount = (geometry.index?.count ?? 0) / 3
  if (triMap.length !== triCount) {
    throw new Error(
      `Subdivision parent map length mismatch: map=${triMap.length}, triangles=${triCount}`,
    )
  }
}

type EdgeSplitMask = {
  ab: boolean
  bc: boolean
  ca: boolean
}

function subdivideTriangleWithEdgeMask(
  ia: number,
  ib: number,
  ic: number,
  mask: EdgeSplitMask,
  getMid: (a: number, b: number) => number,
  pushTri: (a: number, b: number, c: number, pristineTri: number) => void,
  pristineTri: number,
): void {
  const { ab: splitAB, bc: splitBC, ca: splitCA } = mask
  const edgeCount = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0)

  if (edgeCount === 0) {
    pushTri(ia, ib, ic, pristineTri)
    return
  }

  if (edgeCount === 3) {
    const mab = getMid(ia, ib)
    const mbc = getMid(ib, ic)
    const mca = getMid(ic, ia)
    pushTri(ia, mab, mca, pristineTri)
    pushTri(mab, ib, mbc, pristineTri)
    pushTri(mca, mbc, ic, pristineTri)
    pushTri(mab, mbc, mca, pristineTri)
    return
  }

  if (splitAB && !splitBC && !splitCA) {
    const mab = getMid(ia, ib)
    pushTri(ia, mab, ic, pristineTri)
    pushTri(mab, ib, ic, pristineTri)
    return
  }

  if (!splitAB && splitBC && !splitCA) {
    const mbc = getMid(ib, ic)
    pushTri(ib, mbc, ia, pristineTri)
    pushTri(mbc, ic, ia, pristineTri)
    return
  }

  if (!splitAB && !splitBC && splitCA) {
    const mca = getMid(ic, ia)
    pushTri(ic, mca, ib, pristineTri)
    pushTri(mca, ia, ib, pristineTri)
    return
  }

  if (splitAB && splitBC && !splitCA) {
    const mab = getMid(ia, ib)
    const mbc = getMid(ib, ic)
    pushTri(ia, mab, ic, pristineTri)
    pushTri(mab, ib, mbc, pristineTri)
    pushTri(mab, mbc, ic, pristineTri)
    return
  }

  if (splitAB && !splitBC && splitCA) {
    const mab = getMid(ia, ib)
    const mca = getMid(ic, ia)
    pushTri(ia, mab, mca, pristineTri)
    pushTri(mab, ib, ic, pristineTri)
    pushTri(mca, mab, ic, pristineTri)
    return
  }

  if (!splitAB && splitBC && splitCA) {
    const mbc = getMid(ib, ic)
    const mca = getMid(ic, ia)
    pushTri(ia, ib, mbc, pristineTri)
    pushTri(ia, mbc, mca, pristineTri)
    pushTri(mbc, ic, mca, pristineTri)
  }
}

/**
 * Edge-aware subdivision: active triangles drive edge splits; neighboring triangles
 * are subdivided along shared edges to avoid T-junctions.
 */
export function subdivideEdgeAwareOnce(
  geometry: BufferGeometry,
  activeTriangles: Set<number>,
  pristineWorld?: Float32Array | null,
  inputPristineTriMap?: number[],
): SubdivideResult {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) throw new Error('Geometry must be indexed for subdivision.')

  const triCount = index.count / 3
  const pristineTriMap =
    inputPristineTriMap && inputPristineTriMap.length === triCount
      ? [...inputPristineTriMap]
      : Array.from({ length: triCount }, (_, i) => i)

  const splitEdges = new Set<string>()
  for (const t of activeTriangles) {
    if (t < 0 || t >= triCount) continue
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    splitEdges.add(edgeKey(ia, ib))
    splitEdges.add(edgeKey(ib, ic))
    splitEdges.add(edgeKey(ic, ia))
  }

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

    subdivideTriangleWithEdgeMask(
      ia,
      ib,
      ic,
      {
        ab: splitEdges.has(edgeKey(ia, ib)),
        bc: splitEdges.has(edgeKey(ib, ic)),
        ca: splitEdges.has(edgeKey(ic, ia)),
      },
      getMid,
      pushTri,
      pTri,
    )
  }

  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  out.setIndex(newIndices)
  if (newPristineWorld.length > 0) {
    out.setAttribute('pristineWorld', new Float32BufferAttribute(newPristineWorld, 3))
  }
  out.computeVertexNormals()

  assertPristineTriMapLength(newTriMap, out)
  return { geometry: out, pristineTriMap: newTriMap }
}

export type ReliefHeightSampler = (vertexIndex: number) => number

const _triA = new Vector3()
const _triB = new Vector3()
const _triC = new Vector3()

function triangleMaxEdgeLength(
  pos: BufferAttribute,
  ia: number,
  ib: number,
  ic: number,
): number {
  _triA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
  _triB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
  _triC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
  return Math.max(_triA.distanceTo(_triB), _triB.distanceTo(_triC), _triC.distanceTo(_triA))
}

/**
 * Subdivide only where relief height changes or edges are still too long for features.
 * Flat areas between dots stay coarser → smaller files with sharper feature detail.
 */
export function subdivideAdaptiveEdgeAwareOnce(
  geometry: BufferGeometry,
  activeTriangles: Set<number>,
  inputPristineTriMap: number[],
  pristineWorld: Float32Array | null,
  sampleHeight: ReliefHeightSampler,
  fineEdgeTarget: number,
  coarseEdgeTarget: number,
  varianceThreshold: number,
): SubdivideResult {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) throw new Error('Geometry must be indexed for subdivision.')

  const triCount = index.count / 3
  const pristineTriMap =
    inputPristineTriMap.length === triCount
      ? [...inputPristineTriMap]
      : Array.from({ length: triCount }, (_, i) => i)

  const heightCache = new Map<number, number>()
  const heightAt = (vi: number): number => {
    let h = heightCache.get(vi)
    if (h === undefined) {
      h = sampleHeight(vi)
      heightCache.set(vi, h)
    }
    return h
  }

  const splitEdges = new Set<string>()
  for (const t of activeTriangles) {
    if (t < 0 || t >= triCount) continue

    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    const h0 = heightAt(ia)
    const h1 = heightAt(ib)
    const h2 = heightAt(ic)
    const variance = Math.max(h0, h1, h2) - Math.min(h0, h1, h2)
    const maxEdge = triangleMaxEdgeLength(pos, ia, ib, ic)
    const edgeTarget = variance > varianceThreshold ? fineEdgeTarget : coarseEdgeTarget

    if (maxEdge > edgeTarget || (variance > varianceThreshold && maxEdge > fineEdgeTarget * 0.9)) {
      splitEdges.add(edgeKey(ia, ib))
      splitEdges.add(edgeKey(ib, ic))
      splitEdges.add(edgeKey(ic, ia))
    }
  }

  if (splitEdges.size === 0) {
    return { geometry, pristineTriMap }
  }

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

    subdivideTriangleWithEdgeMask(
      ia,
      ib,
      ic,
      {
        ab: splitEdges.has(edgeKey(ia, ib)),
        bc: splitEdges.has(edgeKey(ib, ic)),
        ca: splitEdges.has(edgeKey(ic, ia)),
      },
      getMid,
      pushTri,
      pTri,
    )
  }

  const out = new BufferGeometry()
  out.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  out.setIndex(newIndices)
  if (newPristineWorld.length > 0) {
    out.setAttribute('pristineWorld', new Float32BufferAttribute(newPristineWorld, 3))
  }
  out.computeVertexNormals()

  assertPristineTriMapLength(newTriMap, out)
  return { geometry: out, pristineTriMap: newTriMap }
}

/** @deprecated Use subdivideEdgeAwareOnce — kept for compatibility. */
export function subdivideSelectedTrianglesOnce(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  pristineWorld?: Float32Array | null,
  inputPristineTriMap?: number[],
): SubdivideResult {
  return subdivideEdgeAwareOnce(geometry, selectedTriangles, pristineWorld, inputPristineTriMap)
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

const MAX_SUBDIV_LEVELS = 10

/** Pattern tile density used to size export subdivision for fine relief. */
const PATTERN_CELLS_PER_TILE: Partial<Record<string, number>> = {
  dots: 8,
  grid: 8,
  ribbed: 8,
  waves: 6,
  zigzag: 6,
  brick: 6,
  hex: 6,
  honeycomb: 6,
  scales: 6,
  diamond: 8,
  crosshatch: 8,
}

/** Ink feature radius as a fraction of one pattern cell (matches texture art). */
const PATTERN_FEATURE_RADIUS: Partial<Record<string, number>> = {
  dots: 0.28,
  grid: 0.06,
  scales: 0.34,
  hex: 0.06,
  honeycomb: 0.06,
  diamond: 0.06,
  crosshatch: 0.08,
  ribbed: 0.24,
  waves: 0.2,
  zigzag: 0.18,
  brick: 0.22,
}

export type SubdivisionQuality = 'preview' | ExportQuality

function maxEdgeLengthInSelection(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
): number {
  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) return Infinity

  let maxLen = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()

  for (const t of selectedTriangles) {
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    a.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
    b.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
    c.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
    maxLen = Math.max(maxLen, a.distanceTo(b), b.distanceTo(c), c.distanceTo(a))
  }
  return maxLen
}

export function computeReliefEdgeTargets(
  quality: ExportQuality,
  exportUnitScale: number,
  patternDetail?: {
    patternId: string | null | undefined
    scale: number
    projection: { width: number; height: number }
  },
): { fineEdge: number; coarseEdge: number } {
  const cfg = EXPORT_QUALITY[quality]
  const unit = Math.max(exportUnitScale, 1e-6)
  let fineEdge = cfg.fineEdgeLengthMm / unit
  let coarseEdge = cfg.coarseEdgeLengthMm / unit

  if (patternDetail?.patternId) {
    const cells = PATTERN_CELLS_PER_TILE[patternDetail.patternId] ?? 6
    const s = Math.max(0.05, patternDetail.scale)
    const extent = Math.max(
      patternDetail.projection.width,
      patternDetail.projection.height,
      1e-6,
    )
    const cellSize = extent / (cells * s)
    const featureRadius =
      PATTERN_FEATURE_RADIUS[patternDetail.patternId] ?? 0.5 / cells
    const featureDiameter = cellSize * featureRadius * 2
    fineEdge = featureDiameter / Math.max(cfg.segmentsAcrossFeature, 4)
    coarseEdge = Math.max(coarseEdge, cellSize / 2.5)
  }

  return { fineEdge, coarseEdge }
}

export async function subdivideForReliefPattern(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  pristineSelection: Set<number>,
  pristineWorld: Float32Array | null,
  inputPristineTriMap: number[],
  sampleHeight: ReliefHeightSampler,
  quality: ExportQuality,
  exportUnitScale: number,
  patternDetail?: {
    patternId: string | null | undefined
    scale: number
    projection: { width: number; height: number }
  },
  onProgress?: (fraction: number) => void,
): Promise<SubdivideResult> {
  const cfg = EXPORT_QUALITY[quality]
  const bakeTriangleCap = getExportBakeTriangleCap(quality)
  const { fineEdge, coarseEdge } = computeReliefEdgeTargets(
    quality,
    exportUnitScale,
    patternDetail,
  )

  const sourceGeo = geometry
  let geo = geometry
  let pw: Float32Array | null = pristineWorld
  const currentTriCount = (geo.index?.count ?? 0) / 3
  let triMap =
    inputPristineTriMap.length === currentTriCount
      ? [...inputPristineTriMap]
      : Array.from({ length: currentTriCount }, (_, i) => i)
  let sel = selectedTriangles
  let iterations = 0

  for (let i = 0; i < cfg.maxIterations; i++) {
    const triCount = (geo.index?.count ?? 0) / 3
    if (triCount >= bakeTriangleCap) break

    const maxEdge = maxEdgeLengthInSelection(geo, sel)
    if (maxEdge <= fineEdge) break

    const beforeTris = triCount
    const next = subdivideAdaptiveEdgeAwareOnce(
      geo,
      sel,
      triMap,
      pw,
      sampleHeight,
      fineEdge,
      coarseEdge,
      cfg.varianceThreshold,
    )

    if (next.geometry === geo) break

    if (geo !== sourceGeo) geo.dispose()
    geo = next.geometry
    triMap = next.pristineTriMap
    assertPristineTriMapLength(triMap, geo)
    pw = (geo.getAttribute('pristineWorld')?.array as Float32Array | undefined) ?? pw
    sel = currentTrianglesForPristineSelection(triMap, pristineSelection)
    iterations++

    const afterTris = (geo.index?.count ?? 0) / 3
    if (afterTris === beforeTris) break
    if (afterTris >= bakeTriangleCap) break

    onProgress?.((i + 1) / cfg.maxIterations)
    await yieldIfBusy()
  }

  if (import.meta.env.DEV) {
    console.log('[3MF export] adaptive subdivide iterations:', iterations, {
      fineEdgeMm: (fineEdge * exportUnitScale).toFixed(4),
      coarseEdgeMm: (coarseEdge * exportUnitScale).toFixed(4),
      bakeTriangleCap,
      triangles: (geo.index?.count ?? 0) / 3,
    })
  }

  return { geometry: geo, pristineTriMap: triMap }
}

/** Rough upper-bound estimate for diagnostics only. */
export function estimateReliefSubdivisionIterations(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  quality: SubdivisionQuality,
  exportUnitScale = 1,
  patternDetail?: {
    patternId: string | null | undefined
    scale: number
    projection: { width: number; height: number }
  },
): number {
  if (quality === 'preview') return geometry.index && geometry.index.count / 3 <= 24 ? 1 : 0

  const cfg = EXPORT_QUALITY[quality]
  const { fineEdge } = computeReliefEdgeTargets(quality, exportUnitScale, patternDetail)
  const currentMaxEdge = maxEdgeLengthInSelection(geometry, selectedTriangles)
  if (!Number.isFinite(currentMaxEdge) || currentMaxEdge <= fineEdge) return 0

  const needed = Math.ceil(Math.log(currentMaxEdge / fineEdge) / Math.log(2))
  return Math.min(needed, cfg.maxIterations)
}

export function subdivideSelectedTriangles(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
  levels: number,
  pristineWorld?: Float32Array | null,
  pristineSelection?: Set<number>,
  inputPristineTriMap?: number[],
): SubdivideResult {
  let geo = geometry
  let pw: Float32Array | null = pristineWorld ?? null
  const currentTriCount = (geo.index?.count ?? 0) / 3
  let triMap =
    inputPristineTriMap && inputPristineTriMap.length === currentTriCount
      ? [...inputPristineTriMap]
      : Array.from({ length: currentTriCount }, (_, i) => i)
  let sel = selectedTriangles

  const n = Math.max(0, Math.min(levels, MAX_SUBDIV_LEVELS))
  for (let i = 0; i < n; i++) {
    const next = subdivideEdgeAwareOnce(geo, sel, pw, triMap)
    if (geo !== geometry) geo.dispose()
    geo = next.geometry
    triMap = next.pristineTriMap
    assertPristineTriMapLength(triMap, geo)
    pw = (geo.getAttribute('pristineWorld')?.array as Float32Array | undefined) ?? pw
    if (pristineSelection) {
      sel = currentTrianglesForPristineSelection(triMap, pristineSelection)
    }
  }

  return { geometry: geo, pristineTriMap: triMap }
}
