import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three'
import type { PatternRegion } from '../materials/patternMaterialApply'
import { computePatternBounds } from '../materials/patternBounds'
import { buildProjectionForMesh } from '../materials/patternShaderMaterial'
import { depthLevelToDisplacementWorld, getModelMaxDimension } from '../pattern/patternDepth'
import {
  createProjectionContext,
  samplePatternHeightAtWorld,
} from '../textures/projectionMapping'
import {
  currentTrianglesForPristineSelection,
  subdivideSelectedTriangles,
  subdivisionLevelsForQuality,
} from './subdivideSelection'
import type { PatternMode } from '../../types/pattern'
import { clamp01 } from '../textures/heightMapSampler'

const _pos = new Vector3()
const _n = new Vector3()
const _pw = new Vector3()
const _edge1 = new Vector3()
const _edge2 = new Vector3()
const _faceN = new Vector3()
const _matrixWorld = new Matrix4()

const BOUNDARY_FALLOFF = 0.06
const QUANT = 1e4

export function getEmbossDisplacement(
  height: number,
  mode: PatternMode,
  depthWorld: number,
): number {
  const h = clamp01(height)
  return mode === 'engrave' ? (1 - h) * depthWorld : h * depthWorld
}

function collectTriangleVertices(geometry: BufferGeometry, tris: Set<number>): Set<number> {
  const index = geometry.index
  if (!index) return new Set()
  const verts = new Set<number>()
  for (const t of tris) {
    verts.add(index.getX(t * 3))
    verts.add(index.getX(t * 3 + 1))
    verts.add(index.getX(t * 3 + 2))
  }
  return verts
}

function buildBoundaryDistance(
  geometry: BufferGeometry,
  selectedTriangles: Set<number>,
): Map<number, number> {
  const index = geometry.index
  if (!index) return new Map()

  const edgeCount = new Map<string, number>()
  const vertToEdges = new Map<number, string[]>()
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
    if (!vertToEdges.has(a)) vertToEdges.set(a, [])
    if (!vertToEdges.has(b)) vertToEdges.set(b, [])
    vertToEdges.get(a)!.push(key)
    vertToEdges.get(b)!.push(key)
  }

  for (const t of selectedTriangles) {
    addEdge(index.getX(t * 3), index.getX(t * 3 + 1))
    addEdge(index.getX(t * 3 + 1), index.getX(t * 3 + 2))
    addEdge(index.getX(t * 3 + 2), index.getX(t * 3))
  }

  const boundaryVerts = new Set<number>()
  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split(':').map(Number)
      boundaryVerts.add(a!)
      boundaryVerts.add(b!)
    }
  }

  const dist = new Map<number, number>()
  const queue = [...boundaryVerts]
  for (const v of boundaryVerts) dist.set(v, 0)

  const pos = geometry.getAttribute('position') as BufferAttribute
  while (queue.length > 0) {
    const v = queue.shift()!
    const d0 = dist.get(v) ?? 0
    for (const eKey of vertToEdges.get(v) ?? []) {
      const [a, b] = eKey.split(':').map(Number)
      const other = a === v ? b! : a!
      const step = _pos
        .set(pos.getX(v), pos.getY(v), pos.getZ(v))
        .distanceTo(_n.set(pos.getX(other), pos.getY(other), pos.getZ(other)))
      const nd = d0 + step
      if (!dist.has(other) || dist.get(other)! > nd) {
        dist.set(other, nd)
        queue.push(other)
      }
    }
  }
  return dist
}

function boundaryFalloff(dist: number | undefined): number {
  if (dist === undefined) return 1
  if (dist >= BOUNDARY_FALLOFF) return 1
  const t = dist / BOUNDARY_FALLOFF
  return t * t * (3 - 2 * t)
}

function buildPristineWorldBuffer(mesh: Mesh, pristineGeometry: BufferGeometry): Float32Array {
  mesh.updateWorldMatrix(true, false)
  _matrixWorld.copy(mesh.matrixWorld)
  const pPos = pristineGeometry.getAttribute('position') as BufferAttribute
  const buf = new Float32Array(pPos.count * 3)
  for (let i = 0; i < pPos.count; i++) {
    _pw.set(pPos.getX(i), pPos.getY(i), pPos.getZ(i)).applyMatrix4(_matrixWorld)
    const o = i * 3
    buf[o] = _pw.x
    buf[o + 1] = _pw.y
    buf[o + 2] = _pw.z
  }
  return buf
}

function buildSmoothNormals(
  geometry: BufferGeometry,
  affectedVerts: Set<number>,
): Map<number, Vector3> {
  const pos = geometry.getAttribute('position') as BufferAttribute
  const index = geometry.index
  if (!index) return new Map()

  const idMap = new Map<string, number>()
  const vertexId = new Map<number, number>()
  let nextId = 0

  for (const vi of affectedVerts) {
    const key = `${Math.round(pos.getX(vi) * QUANT)}_${Math.round(pos.getY(vi) * QUANT)}_${Math.round(pos.getZ(vi) * QUANT)}`
    let id = idMap.get(key)
    if (id === undefined) {
      id = nextId++
      idMap.set(key, id)
    }
    vertexId.set(vi, id)
  }

  const accum = Array.from({ length: nextId }, () => new Vector3())
  for (let t = 0; t < index.count / 3; t++) {
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    if (!affectedVerts.has(ia) && !affectedVerts.has(ib) && !affectedVerts.has(ic)) continue

    _edge1.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib)).sub(_pos.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia)))
    _edge2.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic)).sub(_pos)
    _faceN.crossVectors(_edge1, _edge2)

    for (const vi of [ia, ib, ic]) {
      const id = vertexId.get(vi)
      if (id !== undefined) accum[id]!.add(_faceN)
    }
  }

  const smoothById = accum.map((n) => (n.lengthSq() > 1e-12 ? n.normalize() : n.set(0, 0, 1)))
  const result = new Map<number, Vector3>()
  for (const [vi, id] of vertexId) result.set(vi, smoothById[id]!.clone())
  return result
}

export interface BakeReliefParams {
  mesh: Mesh
  modelRoot: Object3D
  geometry: BufferGeometry
  pristineGeometry: BufferGeometry
  region: PatternRegion
  quality: 'preview' | 'apply'
  pristineTriMap: number[]
  pristineWorldBuffer: Float32Array
}

export function bakeReliefIntoGeometry(params: BakeReliefParams): BakeReliefParams {
  let geometry = params.geometry
  const { mesh, modelRoot, pristineGeometry, region, quality } = params
  if (!region.settings.patternId) return params

  mesh.updateWorldMatrix(true, false)
  _matrixWorld.copy(mesh.matrixWorld)

  const modelMaxDim = getModelMaxDimension(modelRoot)
  const depthWorld = depthLevelToDisplacementWorld(region.settings.depth, modelMaxDim)
  if (depthWorld <= 0) return params

  const pristineSelection = new Set(region.triangleIndices)
  const currentSelection = currentTrianglesForPristineSelection(
    params.pristineTriMap,
    pristineSelection,
  )

  const subdiv = subdivideSelectedTriangles(
    geometry,
    currentSelection,
    subdivisionLevelsForQuality(geometry, currentSelection, quality),
    params.pristineWorldBuffer,
    pristineSelection,
  )

  if (subdiv.geometry !== geometry) {
    if (geometry !== params.pristineGeometry) geometry.dispose()
    geometry = subdiv.geometry
  }

  params.pristineTriMap = subdiv.pristineTriMap
  const pwAttr = geometry.getAttribute('pristineWorld')
  params.pristineWorldBuffer = pwAttr
    ? (pwAttr.array as Float32Array)
    : params.pristineWorldBuffer

  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) return { ...params, geometry }

  const activeTris = currentTrianglesForPristineSelection(
    params.pristineTriMap,
    pristineSelection,
  )
  const affectedVerts = collectTriangleVertices(geometry, activeTris)

  const projection = buildProjectionForMesh(
    mesh,
    region.normal,
    region.anchor,
    region.triangleIndices,
    pristineGeometry,
  )
  const bounds = computePatternBounds(mesh, pristineGeometry, region.triangleIndices)
  const mappingCtx = createProjectionContext(
    region.settings.patternId,
    region.settings,
    region.selectionType,
    projection,
    bounds,
  )

  const boundaryDist = buildBoundaryDistance(geometry, activeTris)
  const smoothNormals = buildSmoothNormals(geometry, affectedVerts)
  const pw = params.pristineWorldBuffer

  for (const vi of affectedVerts) {
    const o = vi * 3
    _pw.set(pw[o]!, pw[o + 1]!, pw[o + 2]!)

    const localN = smoothNormals.get(vi)
    if (!localN) continue

    _n.copy(localN).transformDirection(_matrixWorld).normalize()
    const height = samplePatternHeightAtWorld(_pw, _n, mappingCtx)
    const disp =
      getEmbossDisplacement(height, region.settings.mode, depthWorld) *
      boundaryFalloff(boundaryDist.get(vi))

    _pos.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
    _pos.addScaledVector(localN, disp)
    pos.setXYZ(vi, _pos.x, _pos.y, _pos.z)
  }

  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return { ...params, geometry }
}

export function createBakeContext(
  mesh: Mesh,
  pristineGeometry: BufferGeometry,
): Pick<BakeReliefParams, 'pristineTriMap' | 'pristineWorldBuffer'> {
  const triCount =
    (pristineGeometry.index?.count ?? pristineGeometry.getAttribute('position').count) / 3
  return {
    pristineTriMap: Array.from({ length: triCount }, (_, i) => i),
    pristineWorldBuffer: buildPristineWorldBuffer(mesh, pristineGeometry),
  }
}
