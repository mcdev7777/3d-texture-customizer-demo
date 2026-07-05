import {
  BufferGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from 'three'
import type { SurfacePatternSettings } from '../../types/pattern'
import type { SelectedSurface, SelectionMode } from '../../types/surfaceSelection'
import {
  buildPatternMaterialOptions,
  createPatternShaderMaterial,
  isPatternShaderMaterial,
} from './patternShaderMaterial'
import { extractBaseColor, resolveMeshRegionMaterial } from './extractBaseColor'
import { ensureIndexedGeometry, isGeometryPatternReady } from '../geometry/ensureIndexedGeometry'
import {
  bakeReliefIntoGeometry,
  createBakeContext,
} from '../geometry/bakeReliefDisplacement'
import { getConnectedCoplanarSurface } from '../surface/getConnectedCoplanarSurface'
import { getFacesByAngle } from '../surface/selectByAngle'
import { mapLiveFaceIndexToPristine } from '../surface/mapFaceToPristine'
import { clampFaceIndex } from '../surface/meshUtils'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import {
  registerMeshPristineGeometry,
  unregisterMeshPristineGeometry,
  clearMeshPristineRegistry,
} from './meshPatternRegistry'

const PREVIEW_SURFACE_ID = '__preview__'

export interface PatternRegion {
  surfaceId: string
  triangleIndices: readonly number[]
  settings: SurfacePatternSettings
  normal: Vector3
  anchor: Vector3
  selectionType: SelectionMode
}

interface MeshPatternState {
  pristineGeometry: BufferGeometry
  pristineMaterial: Material | Material[]
  regions: PatternRegion[]
}

const meshStates = new Map<string, MeshPatternState>()

function disposeOwnedMaterials(material: Material | Material[]): void {
  const list = Array.isArray(material) ? material : [material]
  for (const mat of list) {
    if (mat) mat.dispose()
  }
}

function disposeMeshPatternState(state: MeshPatternState): void {
  state.pristineGeometry.dispose()
  disposeOwnedMaterials(state.pristineMaterial)
}

function disposeLiveMeshMaterials(mesh: Mesh, state: MeshPatternState): void {
  const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const pristineList = Array.isArray(state.pristineMaterial)
    ? state.pristineMaterial
    : [state.pristineMaterial]

  for (const mat of oldMaterials) {
    if (!mat) continue
    if (mat.userData.isPatternMaterial) {
      mat.dispose()
      continue
    }
    if (!pristineList.includes(mat)) {
      mat.dispose()
    }
  }
}

/** Pristine geometry for pattern indexing — used when resolving picks on modified meshes. */
export { getMeshPatternPristineGeometry } from './meshPatternRegistry'

function cloneMaterial(material: Material): Material {
  try {
    return material.clone()
  } catch {
    return new MeshStandardMaterial({ color: extractBaseColor(material) })
  }
}

function cloneMaterials(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((mat) => (mat ? cloneMaterial(mat) : new MeshStandardMaterial()))
  }
  return material ? cloneMaterial(material) : new MeshStandardMaterial()
}

function ensureMeshState(mesh: Mesh): MeshPatternState {
  let state = meshStates.get(mesh.uuid)
  if (!state) {
    if (!isGeometryPatternReady(mesh.geometry)) {
      throw new Error('Selected mesh has no usable triangle geometry.')
    }
    state = {
      pristineGeometry: ensureIndexedGeometry(mesh.geometry.clone()),
      pristineMaterial: cloneMaterials(mesh.material),
      regions: [],
    }
    meshStates.set(mesh.uuid, state)
    registerMeshPristineGeometry(mesh.uuid, state.pristineGeometry)
  }
  return state
}

function getTriangleCount(geometry: BufferGeometry): number {
  const index = geometry.index
  if (index) return index.count / 3
  return geometry.getAttribute('position').count / 3
}

function getAllTriangleIndices(geometry: BufferGeometry): number[] {
  return Array.from({ length: getTriangleCount(geometry) }, (_, i) => i)
}

function getOriginalMaterial(state: MeshPatternState): Material {
  const mat = state.pristineMaterial
  if (Array.isArray(mat)) {
    return mat.find(Boolean) ?? new MeshStandardMaterial()
  }
  return mat ?? new MeshStandardMaterial()
}

function createRegionMaterial(
  mesh: Mesh,
  modelRoot: Object3D,
  state: MeshPatternState,
  region: PatternRegion,
): Material {
  const baseMaterial = resolveMeshRegionMaterial(
    state.pristineGeometry,
    state.pristineMaterial,
    region.triangleIndices,
  )
  return createPatternShaderMaterial(
    buildPatternMaterialOptions(mesh, modelRoot, state.pristineGeometry, region, baseMaterial),
  )
}

function bakeCommittedIntoGeometry(
  mesh: Mesh,
  modelRoot: Object3D,
  geometry: BufferGeometry,
  state: MeshPatternState,
  committed: PatternRegion[],
): BufferGeometry {
  if (committed.length === 0) return geometry

  let geo = geometry
  let { pristineTriMap, pristineWorldBuffer } = createBakeContext(mesh, state.pristineGeometry)

  for (const region of committed) {
    if (!region.settings.patternId) continue
    const baked = bakeReliefIntoGeometry({
      mesh,
      modelRoot,
      geometry: geo,
      pristineGeometry: state.pristineGeometry,
      region,
      quality: 'apply',
      pristineTriMap,
      pristineWorldBuffer,
    })
    geo = baked.geometry
    pristineTriMap = baked.pristineTriMap
    pristineWorldBuffer = baked.pristineWorldBuffer
  }

  geo.deleteAttribute('pristineWorld')
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function applyShaderRegions(
  mesh: Mesh,
  modelRoot: Object3D,
  state: MeshPatternState,
  geometry: BufferGeometry,
  shaderRegions: PatternRegion[],
): void {
  const indexAttr = geometry.index
  if (!indexAttr) throw new Error('Could not prepare mesh geometry for texturing.')

  const triangleCount = indexAttr.count / 3
  const slotForTriangle = new Int32Array(triangleCount).fill(0)

  for (let ri = 0; ri < shaderRegions.length; ri++) {
    const slot = ri + 1
    for (const t of shaderRegions[ri].triangleIndices) {
      if (t >= 0 && t < triangleCount) slotForTriangle[t] = slot
    }
  }

  const materials: Material[] = [cloneMaterial(getOriginalMaterial(state))]
  const newIndices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []
  const slotOrder = [0, ...shaderRegions.map((_, i) => i + 1)]

  for (const slot of slotOrder) {
    const start = newIndices.length
    for (let t = 0; t < triangleCount; t++) {
      if (slotForTriangle[t] !== slot) continue
      newIndices.push(
        indexAttr.getX(t * 3),
        indexAttr.getX(t * 3 + 1),
        indexAttr.getX(t * 3 + 2),
      )
    }
    const count = newIndices.length - start
    if (count === 0) continue

    let materialIndex = 0
    if (slot > 0) {
      materialIndex = materials.length
      materials.push(createRegionMaterial(mesh, modelRoot, state, shaderRegions[slot - 1]!))
    }
    groups.push({ start, count, materialIndex })
  }

  const rebuilt = geometry.clone()
  rebuilt.setIndex(newIndices)
  rebuilt.clearGroups()
  for (const group of groups) rebuilt.addGroup(group.start, group.count, group.materialIndex)
  rebuilt.computeVertexNormals()

  const oldGeo = mesh.geometry
  if (oldGeo !== state.pristineGeometry) oldGeo.dispose()

  disposeLiveMeshMaterials(mesh, state)

  mesh.geometry = rebuilt
  mesh.material = materials.length === 1 ? materials[0]! : materials

  if (geometry !== state.pristineGeometry && geometry !== rebuilt) {
    geometry.dispose()
  }
}

function rebuildMesh(mesh: Mesh, modelRoot: Object3D, regions: PatternRegion[]): void {
  const state = ensureMeshState(mesh)
  let geometry = ensureIndexedGeometry(state.pristineGeometry.clone())
  if (!geometry.index) {
    geometry.dispose()
    throw new Error('Could not prepare mesh geometry for texturing.')
  }

  if (regions.length > 0) {
    applyShaderRegions(mesh, modelRoot, state, geometry, regions)
  } else {
    const oldGeo = mesh.geometry
    if (oldGeo !== state.pristineGeometry) oldGeo.dispose()

    disposeLiveMeshMaterials(mesh, state)

    mesh.geometry = geometry
    mesh.material = cloneMaterials(state.pristineMaterial)
  }
}

/** Bake committed pattern relief into geometry for export (not used for viewport). */
export function bakeCommittedPatternsIntoGeometry(
  mesh: Mesh,
  modelRoot: Object3D,
): BufferGeometry {
  const state = meshStates.get(mesh.uuid)
  if (!state) return mesh.geometry.clone()

  const committed = state.regions.filter((r) => r.surfaceId !== PREVIEW_SURFACE_ID)
  if (committed.length === 0) return mesh.geometry.clone()

  let geometry = ensureIndexedGeometry(state.pristineGeometry.clone())
  if (!geometry.index) {
    geometry.dispose()
    throw new Error('Could not prepare mesh geometry for texturing.')
  }

  return bakeCommittedIntoGeometry(mesh, modelRoot, geometry, state, committed)
}

function resolveTriangleIndices(
  mesh: Mesh,
  state: MeshPatternState,
  selectedSurface: SelectedSurface,
): number[] {
  const geo = state.pristineGeometry
  if (selectedSurface.selectionType === 'part') {
    return getAllTriangleIndices(geo)
  }

  const triCount = getTriangleCount(geo)
  const fromSelection = selectedSurface.triangleIndices
  if (
    fromSelection.length > 0 &&
    fromSelection.every((t) => t >= 0 && t < triCount)
  ) {
    return [...fromSelection]
  }

  const liveFace = clampFaceIndex(selectedSurface.faceIndex, getTriangleCount(mesh.geometry))
  const pristineFace = mapLiveFaceIndexToPristine(mesh, geo, liveFace)
  const { angleTolerance, connectedOnly } = useSurfaceSelectionStore.getState()
  return connectedOnly
    ? getConnectedCoplanarSurface(geo, mesh, pristineFace, angleTolerance)
    : getFacesByAngle(geo, mesh, pristineFace, angleTolerance)
}

function buildRegion(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
  surfaceId: string,
): PatternRegion {
  const state = ensureMeshState(mesh)
  return {
    surfaceId,
    triangleIndices: resolveTriangleIndices(mesh, state, selectedSurface),
    settings: { ...settings },
    normal: selectedSurface.normal.clone(),
    anchor: selectedSurface.point.clone(),
    selectionType: selectedSurface.selectionType,
  }
}

export function updateCommittedRegionSettings(
  mesh: Mesh,
  modelRoot: Object3D,
  surfaceId: string,
  settings: SurfacePatternSettings,
): boolean {
  const state = meshStates.get(mesh.uuid)
  if (!state) return false

  const region = state.regions.find((r) => r.surfaceId === surfaceId)
  if (!region) return false

  region.settings = { ...settings }
  rebuildMesh(mesh, modelRoot, state.regions)
  return true
}

export function applyPreviewPattern(
  mesh: Mesh,
  modelRoot: Object3D,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  const state = ensureMeshState(mesh)
  const previewRegion = buildRegion(mesh, selectedSurface, settings, PREVIEW_SURFACE_ID)
  const committed = state.regions.filter((r) => r.surfaceId !== PREVIEW_SURFACE_ID)
  rebuildMesh(mesh, modelRoot, [...committed, previewRegion])
}

export function removePreviewPattern(mesh: Mesh, modelRoot: Object3D): void {
  const state = meshStates.get(mesh.uuid)
  if (!state) return
  rebuildMesh(mesh, modelRoot, state.regions)
}

export function commitPatternMaterial(
  mesh: Mesh,
  modelRoot: Object3D,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  const state = ensureMeshState(mesh)
  const region = buildRegion(mesh, selectedSurface, settings, selectedSurface.surfaceId)
  state.regions = state.regions.filter((r) => r.surfaceId !== selectedSurface.surfaceId)
  state.regions.push(region)
  rebuildMesh(mesh, modelRoot, state.regions)
}

export function resetMeshPatterns(mesh: Mesh): void {
  const state = meshStates.get(mesh.uuid)
  if (!state) return

  if (mesh.geometry !== state.pristineGeometry) mesh.geometry.dispose()
  disposeLiveMeshMaterials(mesh, state)

  mesh.geometry = state.pristineGeometry.clone()
  mesh.material = cloneMaterials(state.pristineMaterial)
  disposeMeshPatternState(state)
  unregisterMeshPristineGeometry(mesh.uuid)
  meshStates.delete(mesh.uuid)
}

export function resetAllPatterns(modelRoot: Object3D | null): void {
  if (modelRoot) {
    modelRoot.traverse((child) => {
      if ('isMesh' in child && child.isMesh) resetMeshPatterns(child as Mesh)
    })
  } else {
    for (const state of meshStates.values()) {
      disposeMeshPatternState(state)
    }
    meshStates.clear()
    clearMeshPristineRegistry()
  }
}

export function uncommitSurfacePattern(modelRoot: Object3D | null, surfaceId: string): boolean {
  if (!modelRoot) return false

  let found = false
  modelRoot.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return
    const mesh = child as Mesh
    const state = meshStates.get(mesh.uuid)
    if (!state?.regions.some((r) => r.surfaceId === surfaceId)) return

    found = true
    state.regions = state.regions.filter((r) => r.surfaceId !== surfaceId)
    if (state.regions.length === 0) resetMeshPatterns(mesh)
    else rebuildMesh(mesh, modelRoot, state.regions)
  })
  return found
}

export { isPatternShaderMaterial }
