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
import { depthLevelToDisplacementWorld } from '../pattern/patternDepth'
import {
  createProjectionContext,
  samplePatternHeightAtWorld,
} from '../textures/projectionMapping'
import {
  applyContrast,
  applyRoundedProfile,
  getExportUnitScale,
} from '../textures/patternPlacementMath'
import {
  currentTrianglesForPristineSelection,
  estimateReliefSubdivisionIterations,
  subdivideForReliefPattern,
  type SubdivisionQuality,
} from './subdivideSelection'
import type { PatternMode } from '../../types/pattern'
import { clamp01 } from '../textures/heightMapSampler'
import { yieldIfBusy } from '../export/exportProgress'

const _pos = new Vector3()
const _n = new Vector3()
const _pw = new Vector3()
const _vA = new Vector3()
const _vB = new Vector3()
const _vC = new Vector3()
const _matrixWorld = new Matrix4()
const _invMatrixWorld = new Matrix4()

const BOUNDARY_FALLOFF = 0.06
const VERTEX_QUANT = 1e5

/**
 * Displacement along the surface normal from a luminance height sample.
 * Built-in patterns use dark ink on white; the invert setting flips which tones
 * count as raised features. Matches shader preview emboss/engrave intent.
 */
export function getEmbossDisplacement(
  height: number,
  mode: PatternMode,
  depthWorld: number,
  inverted = false,
): number {
  const h = clamp01(height)
  const ink = inverted ? h : 1 - h
  const raised = mode === 'engrave' ? 1 - ink : ink
  return raised * depthWorld
}

function shapeReliefHeight(raw: number, smoothing: number): number {
  let h = applyRoundedProfile(applyContrast(raw))
  const sm = clamp01(smoothing)
  if (sm > 0) {
    const softened = h * h * (3 - 2 * h)
    h = h * (1 - sm) + softened * sm
  }
  return h
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

function vertexPositionKey(pos: BufferAttribute, vi: number): string {
  return `${Math.round(pos.getX(vi) * VERTEX_QUANT)}:${Math.round(pos.getY(vi) * VERTEX_QUANT)}:${Math.round(pos.getZ(vi) * VERTEX_QUANT)}`
}

function getLocalRegionNormal(mesh: Mesh, region: PatternRegion): Vector3 {
  _invMatrixWorld.copy(mesh.matrixWorld).invert()
  return region.normal.clone().transformDirection(_invMatrixWorld).normalize()
}

export interface BakeReliefParams {
  mesh: Mesh
  modelRoot: Object3D
  geometry: BufferGeometry
  pristineGeometry: BufferGeometry
  region: PatternRegion
  quality: SubdivisionQuality
  exportUnitScale?: number
  pristineTriMap: number[]
  pristineWorldBuffer: Float32Array
}

export async function bakeReliefIntoGeometry(
  params: BakeReliefParams,
  onSubdivideProgress?: (fraction: number) => void,
): Promise<BakeReliefParams> {
  let geometry = params.geometry
  const { mesh, modelRoot, pristineGeometry, region, quality } = params
  if (!region.settings.patternId) return params

  mesh.updateWorldMatrix(true, false)
  _matrixWorld.copy(mesh.matrixWorld)

  const mappingMode = region.mappingMode ?? region.selectionType

  if (import.meta.env.DEV) {
    console.log(
      '[3MF export] mapping mode:',
      mappingMode,
      'region:',
      region.surfaceId,
      'pristineTriMap length:',
      params.pristineTriMap.length,
    )
  }

  const exportUnitScale = params.exportUnitScale ?? getExportUnitScale(modelRoot)
  const depthWorld = depthLevelToDisplacementWorld(region.settings.depth, exportUnitScale)
  if (depthWorld <= 0) return params

  const pristineSelection = new Set(region.triangleIndices)
  const currentSelection = currentTrianglesForPristineSelection(
    params.pristineTriMap,
    pristineSelection,
  )

  const projection = buildProjectionForMesh(
    mesh,
    region.normal,
    region.anchor,
    region.triangleIndices,
    pristineGeometry,
  )

  const boundsTriangles =
    mappingMode === 'part'
      ? (region.cubicBoundsTriangles ?? region.triangleIndices)
      : region.triangleIndices
  const bounds = computePatternBounds(mesh, pristineGeometry, boundsTriangles)

  const exportQuality = quality === 'preview' ? 'high' : quality
  const mappingCtx = createProjectionContext(
    region.settings.patternId,
    region.settings,
    mappingMode,
    projection,
    bounds,
    exportUnitScale,
    exportQuality,
  )

  const worldSampleNormal = region.normal.clone().normalize()
  // Fully smoothstep-shaped relief edges (max softness) — at least 5x softer
  // than the previous 0.35 floor, since 0.35 was already close to the
  // shapeReliefHeight blend's ceiling of 1.
  const reliefSmoothing = 1

  const sampleReliefHeightAtVertex = (vertexIndex: number): number => {
    const o = vertexIndex * 3
    _pw.set(
      params.pristineWorldBuffer[o]!,
      params.pristineWorldBuffer[o + 1]!,
      params.pristineWorldBuffer[o + 2]!,
    )
    const raw = samplePatternHeightAtWorld(_pw, worldSampleNormal, mappingCtx)
    return shapeReliefHeight(raw, reliefSmoothing)
  }

  const patternDetail = {
    patternId: region.settings.patternId,
    scale: region.settings.scale,
    projection,
  }

  if (import.meta.env.DEV) {
    console.log(
      '[3MF export] estimated subdivide iterations:',
      estimateReliefSubdivisionIterations(
        geometry,
        currentSelection,
        quality,
        exportUnitScale,
        patternDetail,
      ),
      'quality:',
      quality,
    )
  }

  const subdiv = await subdivideForReliefPattern(
    geometry,
    currentSelection,
    pristineSelection,
    params.pristineWorldBuffer,
    params.pristineTriMap,
    sampleReliefHeightAtVertex,
    exportQuality,
    exportUnitScale,
    patternDetail,
    onSubdivideProgress,
  )

  if (subdiv.geometry !== geometry) {
    if (geometry !== pristineGeometry) geometry.dispose()
    geometry = subdiv.geometry
  }

  params.pristineTriMap = subdiv.pristineTriMap
  const pwAttr = geometry.getAttribute('pristineWorld')
  params.pristineWorldBuffer = pwAttr
    ? (pwAttr.array as Float32Array)
    : params.pristineWorldBuffer

  if (import.meta.env.DEV) {
    const triCount = (geometry.index?.count ?? 0) / 3
    if (params.pristineTriMap.length !== triCount) {
      throw new Error('Subdivision parent map length mismatch after bake subdivide.')
    }
  }

  const index = geometry.index
  const pos = geometry.getAttribute('position') as BufferAttribute
  if (!index) return { ...params, geometry }

  const activeTris = currentTrianglesForPristineSelection(
    params.pristineTriMap,
    pristineSelection,
  )
  const affectedVerts = collectTriangleVertices(geometry, activeTris)
  const affectedSet = affectedVerts

  const boundaryDist = buildBoundaryDistance(geometry, activeTris)
  const localDispNormal = getLocalRegionNormal(mesh, region)

  const vertsByKey = new Map<string, number[]>()
  for (const vi of affectedSet) {
    const key = vertexPositionKey(pos, vi)
    const group = vertsByKey.get(key)
    if (group) group.push(vi)
    else vertsByKey.set(key, [vi])
  }

  const smoothNormals = new Map<string, Vector3>()
  const accum = new Map<string, { x: number; y: number; z: number; w: number }>()

  let triIndex = 0
  for (const t of activeTris) {
    const ia = index.getX(t * 3)
    const ib = index.getX(t * 3 + 1)
    const ic = index.getX(t * 3 + 2)
    _vA.set(pos.getX(ia), pos.getY(ia), pos.getZ(ia))
    _vB.set(pos.getX(ib), pos.getY(ib), pos.getZ(ib))
    _vC.set(pos.getX(ic), pos.getY(ic), pos.getZ(ic))
    _n.subVectors(_vB, _vA).cross(_pw.subVectors(_vC, _vA))
    const area = _n.length()
    if (area < 1e-12) {
      triIndex++
      continue
    }
    _n.divideScalar(area)

    for (const vi of [ia, ib, ic]) {
      const key = vertexPositionKey(pos, vi)
      let entry = accum.get(key)
      if (!entry) {
        entry = { x: 0, y: 0, z: 0, w: 0 }
        accum.set(key, entry)
      }
      entry.x += _n.x * area
      entry.y += _n.y * area
      entry.z += _n.z * area
      entry.w += area
    }

    triIndex++
    if (triIndex % 4096 === 0) {
      await yieldIfBusy()
    }
  }

  for (const [key, entry] of accum) {
    const len = Math.hypot(entry.x, entry.y, entry.z)
    if (len > 1e-12) {
      smoothNormals.set(key, new Vector3(entry.x / len, entry.y / len, entry.z / len))
    }
  }

  let groupIndex = 0
  for (const [key, vertIndices] of vertsByKey) {
    const vi = vertIndices[0]!
    const shapedHeight = sampleReliefHeightAtVertex(vi)
    const disp =
      getEmbossDisplacement(
        shapedHeight,
        region.settings.mode,
        depthWorld,
        region.settings.invert ?? false,
      ) * boundaryFalloff(boundaryDist.get(vi))

    const dispNormal = smoothNormals.get(key) ?? localDispNormal
    for (const v of vertIndices) {
      _pos.set(pos.getX(v), pos.getY(v), pos.getZ(v))
      _pos.addScaledVector(dispNormal, disp)
      pos.setXYZ(v, _pos.x, _pos.y, _pos.z)
    }

    groupIndex++
    if (groupIndex % 2048 === 0) {
      await yieldIfBusy()
    }
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
