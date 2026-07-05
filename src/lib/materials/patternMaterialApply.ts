import {
  BufferGeometry,
  Material,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from 'three'
import type { SurfacePatternSettings } from '../../types/pattern'
import type { SelectedSurface, SelectionMode } from '../../types/surfaceSelection'
import {
  buildPatternMaterialOptions,
  createPatternShaderMaterial,
} from './patternShaderMaterial'
import { extractBaseColor } from './extractBaseColor'

const PREVIEW_SURFACE_ID = '__preview__'

export interface PatternRegion {
  surfaceId: string
  triangleIndices: readonly number[]
  settings: SurfacePatternSettings
  baseColorHex: number
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

function cloneMaterial(material: Material): Material {
  return material.clone()
}

function cloneMaterials(material: Material | Material[]): Material | Material[] {
  return Array.isArray(material) ? material.map(cloneMaterial) : cloneMaterial(material)
}

function ensureMeshState(mesh: Mesh): MeshPatternState {
  let state = meshStates.get(mesh.uuid)
  if (!state) {
    state = {
      pristineGeometry: mesh.geometry.clone(),
      pristineMaterial: cloneMaterials(mesh.material),
      regions: [],
    }
    meshStates.set(mesh.uuid, state)
  }
  return state
}

function getTriangleCount(geometry: BufferGeometry): number {
  const index = geometry.index
  if (index) return index.count / 3
  return geometry.getAttribute('position').count / 3
}

function getAllTriangleIndices(geometry: BufferGeometry): number[] {
  const count = getTriangleCount(geometry)
  return Array.from({ length: count }, (_, i) => i)
}

function ensureIndexed(geometry: BufferGeometry): BufferGeometry {
  if (geometry.index) return geometry
  return geometry.toNonIndexed()
}

function getOriginalMaterial(state: MeshPatternState): Material {
  const mat = state.pristineMaterial
  return Array.isArray(mat) ? mat[0] : mat
}

function createRegionMaterial(
  mesh: Mesh,
  state: MeshPatternState,
  region: PatternRegion,
): ShaderMaterial {
  const options = buildPatternMaterialOptions(
    mesh,
    state.pristineGeometry,
    region,
    getOriginalMaterial(state),
  )
  return createPatternShaderMaterial(options)
}

function rebuildMesh(mesh: Mesh, regions: PatternRegion[]): void {
  const state = ensureMeshState(mesh)
  const indexed = ensureIndexed(state.pristineGeometry.clone())
  const indexAttr = indexed.index!
  const triangleCount = indexAttr.count / 3

  const slotForTriangle = new Int32Array(triangleCount).fill(0)
  for (let ri = 0; ri < regions.length; ri++) {
    const slot = ri + 1
    for (const t of regions[ri].triangleIndices) {
      if (t >= 0 && t < triangleCount) slotForTriangle[t] = slot
    }
  }

  const materials: Material[] = [cloneMaterial(getOriginalMaterial(state))]
  const newIndices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []

  const slotOrder = [0, ...regions.map((_, i) => i + 1)]

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
      materials.push(createRegionMaterial(mesh, state, regions[slot - 1]))
    }

    groups.push({ start, count, materialIndex })
  }

  const rebuilt = indexed.clone()
  rebuilt.setIndex(newIndices)
  rebuilt.clearGroups()
  for (const group of groups) rebuilt.addGroup(group.start, group.count, group.materialIndex)
  rebuilt.computeVertexNormals()
  indexed.dispose()

  const oldGeo = mesh.geometry
  if (oldGeo !== state.pristineGeometry) oldGeo.dispose()

  const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const mat of oldMaterials) {
    if (mat.userData.isPatternMaterial) mat.dispose()
  }

  mesh.geometry = rebuilt
  mesh.material = materials.length === 1 ? materials[0] : materials
}

function buildRegion(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
  surfaceId: string,
): PatternRegion {
  const state = ensureMeshState(mesh)
  const triangleIndices =
    selectedSurface.selectionType === 'part'
      ? getAllTriangleIndices(state.pristineGeometry)
      : selectedSurface.triangleIndices

  return {
    surfaceId,
    triangleIndices,
    settings,
    baseColorHex: extractBaseColor(getOriginalMaterial(state)).getHex(),
    normal: selectedSurface.normal.clone(),
    anchor: selectedSurface.point.clone(),
    selectionType: selectedSurface.selectionType,
  }
}

export function applyPreviewPattern(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  const state = ensureMeshState(mesh)
  const previewRegion = buildRegion(mesh, selectedSurface, settings, PREVIEW_SURFACE_ID)
  const committed = state.regions.filter((r) => r.surfaceId !== PREVIEW_SURFACE_ID)
  rebuildMesh(mesh, [...committed, previewRegion])
}

export function removePreviewPattern(mesh: Mesh): void {
  const state = meshStates.get(mesh.uuid)
  if (!state) return
  rebuildMesh(mesh, state.regions)
}

export function commitPatternMaterial(
  mesh: Mesh,
  selectedSurface: SelectedSurface,
  settings: SurfacePatternSettings,
): void {
  const state = ensureMeshState(mesh)
  const region = buildRegion(mesh, selectedSurface, settings, selectedSurface.surfaceId)
  state.regions = state.regions.filter((r) => r.surfaceId !== selectedSurface.surfaceId)
  state.regions.push(region)
  rebuildMesh(mesh, state.regions)
}

export function resetMeshPatterns(mesh: Mesh): void {
  const state = meshStates.get(mesh.uuid)
  if (!state) return

  if (mesh.geometry !== state.pristineGeometry) mesh.geometry.dispose()

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const mat of materials) {
    if (mat.userData.isPatternMaterial) mat.dispose()
  }

  mesh.geometry = state.pristineGeometry.clone()
  mesh.material = cloneMaterials(state.pristineMaterial)
  meshStates.delete(mesh.uuid)
}

export function resetAllPatterns(modelRoot: Object3D | null): void {
  if (!modelRoot) {
    meshStates.clear()
    return
  }

  const meshes: Mesh[] = []
  modelRoot.traverse((child) => {
    if ('isMesh' in child && child.isMesh) meshes.push(child as Mesh)
  })

  for (const mesh of meshes) resetMeshPatterns(mesh)
  meshStates.clear()
}

/** Remove one committed pattern region and restore geometry/material if none remain. */
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
    if (state.regions.length === 0) {
      resetMeshPatterns(mesh)
    } else {
      rebuildMesh(mesh, state.regions)
    }
  })
  return found
}

export function isPatternShaderMaterial(material: Material): material is ShaderMaterial {
  return material instanceof ShaderMaterial && material.userData.isPatternMaterial === true
}
