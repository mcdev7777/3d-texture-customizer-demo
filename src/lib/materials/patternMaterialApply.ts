import {
  Box3,
  BufferGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from 'three'
import type { SurfacePatternSettings, SurfacePatternPlacement } from '../../types/pattern'
import type { ExportQuality } from '../../types/bake'
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
import { splitVerticesAlongPatchBoundary, splitVerticesAlongSharpEdges } from '../geometry/splitSharpEdges'
import { buildSurfaceIslands } from '../geometry/surfaceIslands'
import { getConnectedCoplanarSurface } from '../surface/getConnectedCoplanarSurface'
import { getFacesByAngle } from '../surface/selectByAngle'
import { mapLiveFaceIndexToPristine } from '../surface/mapFaceToPristine'
import { clampFaceIndex } from '../surface/meshUtils'
import { buildSelectedSurfaceFromId, findMeshByUuid, parseSurfaceId } from '../surface/restoreSurfaceFromId'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import {
  registerMeshPristineGeometry,
  unregisterMeshPristineGeometry,
  clearMeshPristineRegistry,
} from './meshPatternRegistry'

const PREVIEW_PREFIX = '__preview__:'

function previewRegionId(surfaceId: string): string {
  return `${PREVIEW_PREFIX}${surfaceId}`
}

function isPreviewRegion(surfaceId: string): boolean {
  return surfaceId.startsWith(PREVIEW_PREFIX)
}

export interface PatternRegion {
  surfaceId: string
  triangleIndices: readonly number[]
  settings: SurfacePatternSettings
  normal: Vector3
  anchor: Vector3
  selectionType: SelectionMode
  /** How pattern UVs are sampled; defaults to selectionType when omitted. */
  mappingMode?: SelectionMode
  /** Full part triangle set for cubic bounds when islands bake with part mapping. */
  cubicBoundsTriangles?: readonly number[]
  /**
   * World-space cubic-mapping bounds override, shared by every region in a
   * "Merged" pattern group that spans more than one mesh. A PatternRegion's
   * triangleIndices can only reference one mesh's own geometry, so a
   * cross-mesh merge still becomes N separate regions (one per mesh) — but
   * giving every one of them this same bounds reference (instead of each
   * computing its own, mesh-local bounds) keeps the cubic-mapped pattern at
   * one consistent scale/alignment across all the merged meshes, so it reads
   * as one continuous treatment instead of a separate pattern per part.
   */
  sharedBoundsWorld?: { min: Vector3; max: Vector3 }
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

// Mesh UUIDs whose *committed* (not in-progress preview) regions should
// render invisible on the original mesh — used by 3D Preview mode, which
// shows a separate real-geometry overlay in their place instead. Colour and
// depth writes are both off so the invisible surface can't occlude the
// overlay or leave a depth-buffer shadow; the geometry itself is untouched
// so raycasting/selection against the rest of the mesh is unaffected.
const hiddenCommittedMeshes = new Set<string>()

function createInvisibleMaterial(): Material {
  return new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
}

function createRegionMaterial(
  mesh: Mesh,
  modelRoot: Object3D,
  state: MeshPatternState,
  region: PatternRegion,
): Material {
  if (hiddenCommittedMeshes.has(mesh.uuid) && !isPreviewRegion(region.surfaceId)) {
    return createInvisibleMaterial()
  }
  const baseMaterial = resolveMeshRegionMaterial(
    state.pristineGeometry,
    state.pristineMaterial,
    region.triangleIndices,
  )
  return createPatternShaderMaterial(
    buildPatternMaterialOptions(mesh, modelRoot, state.pristineGeometry, region, baseMaterial),
  )
}

function expandRegionsForExport(
  mesh: Mesh,
  state: MeshPatternState,
  regions: PatternRegion[],
): PatternRegion[] {
  const { angleTolerance } = useSurfaceSelectionStore.getState()
  const expanded: PatternRegion[] = []

  for (const region of regions) {
    if (region.selectionType !== 'part') {
      expanded.push(region)
      continue
    }

    const islands = buildSurfaceIslands(
      state.pristineGeometry,
      mesh,
      region.triangleIndices,
      angleTolerance,
      region.surfaceId,
    )

    for (const island of islands) {
      expanded.push({
        surfaceId: island.id,
        triangleIndices: island.faceIds,
        settings: region.settings,
        normal: island.normal,
        anchor: island.anchor,
        selectionType: 'surface',
        mappingMode: 'part',
        cubicBoundsTriangles: region.triangleIndices,
      })
    }
  }

  return expanded
}

async function bakeCommittedIntoGeometry(
  mesh: Mesh,
  modelRoot: Object3D,
  geometry: BufferGeometry,
  state: MeshPatternState,
  regions: PatternRegion[],
  quality: ExportQuality,
  exportUnitScale: number,
  onProgress?: (fraction: number, label: string) => void,
): Promise<BufferGeometry> {
  if (regions.length === 0) return geometry

  const exportRegions = expandRegionsForExport(mesh, state, regions)

  if (import.meta.env.DEV) {
    console.log('[3MF export] target mesh:', mesh.uuid)
    console.log('[3MF export] placement regions:', regions.length)
    console.log('[3MF export] bake regions:', exportRegions.length)
    console.log(
      '[3MF export] surface islands:',
      exportRegions.map((r) => ({
        id: r.surfaceId,
        faceCount: r.triangleIndices.length,
        selectionType: r.selectionType,
        mappingMode: r.mappingMode ?? r.selectionType,
        normal: r.normal.toArray().map((v) => +v.toFixed(3)),
      })),
    )
  }

  let geo = splitVerticesAlongSharpEdges(geometry)
  if (geo !== geometry) geometry.dispose()

  const patchTriangles = new Set<number>()
  for (const region of exportRegions) {
    for (const t of region.triangleIndices) patchTriangles.add(t)
  }
  const withBoundary = splitVerticesAlongPatchBoundary(geo, patchTriangles)
  if (withBoundary !== geo) {
    geo.dispose()
    geo = withBoundary
  }

  const pristineExportGeometry = geo
  let { pristineTriMap, pristineWorldBuffer } = createBakeContext(mesh, pristineExportGeometry)

  const regionCount = exportRegions.filter((r) => r.settings.patternId).length
  let regionIndex = 0

  for (const region of exportRegions) {
    if (!region.settings.patternId) continue

    const regionStart = regionIndex / Math.max(regionCount, 1)
    regionIndex++
    const regionEnd = regionIndex / Math.max(regionCount, 1)

    onProgress?.(
      regionStart,
      regionCount > 1
        ? `Baking pattern ${regionIndex}/${regionCount}…`
        : 'Baking relief…',
    )

    const baked = await bakeReliefIntoGeometry(
      {
        mesh,
        modelRoot,
        geometry: geo,
        pristineGeometry: pristineExportGeometry,
        region,
        quality,
        exportUnitScale,
        pristineTriMap,
        pristineWorldBuffer,
      },
      (subFraction) => {
        const fraction = regionStart + (regionEnd - regionStart) * subFraction * 0.85
        onProgress?.(fraction, regionCount > 1 ? `Refining mesh (${regionIndex}/${regionCount})…` : 'Refining mesh…')
      },
    )
    geo = baked.geometry
    pristineTriMap = baked.pristineTriMap
    pristineWorldBuffer = baked.pristineWorldBuffer
  }

  onProgress?.(1, 'Bake complete')

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

export function collectAllExportRegionsForMesh(
  mesh: Mesh,
  modelRoot: Object3D,
  placements: Record<string, SurfacePatternPlacement>,
  committedSurfaceIds: readonly string[],
): PatternRegion[] {
  const committed = new Set(committedSurfaceIds)
  const regions: PatternRegion[] = []
  const seen = new Set<string>()
  const state = meshStates.get(mesh.uuid)

  if (state) {
    for (const region of state.regions) {
      if (isPreviewRegion(region.surfaceId)) continue
      if (!committed.has(region.surfaceId)) continue

      const placement = placements[region.surfaceId]
      const settings = {
        ...region.settings,
        ...(placement?.settings ?? {}),
      }
      if (!settings.patternId) continue

      regions.push({
        surfaceId: region.surfaceId,
        triangleIndices: region.triangleIndices,
        settings,
        normal: region.normal.clone(),
        anchor: region.anchor.clone(),
        selectionType: region.selectionType,
        mappingMode: region.mappingMode ?? region.selectionType,
        cubicBoundsTriangles: region.cubicBoundsTriangles,
        sharedBoundsWorld: region.sharedBoundsWorld
          ? { min: region.sharedBoundsWorld.min.clone(), max: region.sharedBoundsWorld.max.clone() }
          : undefined,
      })
      seen.add(region.surfaceId)
    }
  }

  for (const surfaceId of committedSurfaceIds) {
    if (seen.has(surfaceId)) continue

    const placement = placements[surfaceId]
    if (!placement?.settings.patternId) continue

    const parsed = parseSurfaceId(surfaceId)
    if (!parsed || parsed.meshUuid !== mesh.uuid) continue

    const surface = buildSelectedSurfaceFromId(surfaceId, modelRoot)
    if (!surface) continue

    try {
      regions.push(buildRegion(mesh, surface, placement.settings, surfaceId))
      seen.add(surfaceId)
    } finally {
      surface.highlightGeometry.dispose()
    }
  }

  return regions
}

/**
 * Rebuild committed pattern regions on every mesh before export so all applied
 * surfaces are present even if the user changed selection after applying.
 */
export function refreshCommittedPatternsForExport(
  modelRoot: Object3D,
  placements: Record<string, SurfacePatternPlacement>,
  committedSurfaceIds: readonly string[],
): void {
  const byMesh = new Map<string, string[]>()
  for (const surfaceId of committedSurfaceIds) {
    const placement = placements[surfaceId]
    if (!placement?.settings.patternId) continue
    const parsed = parseSurfaceId(surfaceId)
    if (!parsed) continue
    const list = byMesh.get(parsed.meshUuid) ?? []
    list.push(surfaceId)
    byMesh.set(parsed.meshUuid, list)
  }

  for (const [meshUuid, surfaceIds] of byMesh) {
    const mesh = findMeshByUuid(modelRoot, meshUuid)
    if (!mesh) continue

    const state = ensureMeshState(mesh)
    const regionMap = new Map<string, PatternRegion>()
    for (const region of state.regions) {
      if (!isPreviewRegion(region.surfaceId)) {
        regionMap.set(region.surfaceId, region)
      }
    }

    for (const surfaceId of surfaceIds) {
      const placement = placements[surfaceId]
      if (!placement?.settings.patternId) continue
      const surface = buildSelectedSurfaceFromId(surfaceId, modelRoot)
      if (!surface) continue
      try {
        regionMap.set(
          surfaceId,
          buildRegion(mesh, surface, placement.settings, surfaceId),
        )
      } finally {
        surface.highlightGeometry.dispose()
      }
    }

    state.regions = [...regionMap.values()]
    rebuildMesh(mesh, modelRoot, state.regions)
  }
}

function cloneBaseGeometryForExport(mesh: Mesh): BufferGeometry {
  const state = meshStates.get(mesh.uuid)
  if (state) return ensureIndexedGeometry(state.pristineGeometry.clone())
  return ensureIndexedGeometry(mesh.geometry.clone())
}

/** Bake all committed pattern regions into a cloned geometry for printable export. */
export async function bakePatternsForExport(
  mesh: Mesh,
  modelRoot: Object3D,
  placements: Record<string, SurfacePatternPlacement>,
  committedSurfaceIds: readonly string[],
  quality: ExportQuality,
  exportUnitScale: number,
  onProgress?: (fraction: number, label: string) => void,
): Promise<BufferGeometry> {
  const regions = collectAllExportRegionsForMesh(
    mesh,
    modelRoot,
    placements,
    committedSurfaceIds,
  )
  if (regions.length === 0) return cloneBaseGeometryForExport(mesh)

  if (import.meta.env.DEV) {
    const selectedFaceCount = regions.reduce((n, r) => n + r.triangleIndices.length, 0)
    console.log('[3MF export] committed regions on mesh:', regions.length)
    console.log('[3MF export] selected triangle count:', selectedFaceCount)
  }

  const state = ensureMeshState(mesh)
  let geometry = ensureIndexedGeometry(state.pristineGeometry.clone())
  if (!geometry.index) {
    geometry.dispose()
    throw new Error('Could not prepare mesh geometry for export baking.')
  }

  return bakeCommittedIntoGeometry(
    mesh,
    modelRoot,
    geometry,
    state,
    regions,
    quality,
    exportUnitScale,
    onProgress,
  )
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
    mappingMode: selectedSurface.selectionType,
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
  syncMeshPreviewPatterns(mesh, modelRoot, [{ surface: selectedSurface, settings }])
}

export interface MeshPreviewTarget {
  surface: SelectedSurface
  settings: SurfacePatternSettings
}

/**
 * When set, `syncMeshPreviewPatterns` collapses every preview target on this
 * mesh into ONE merged preview region (mirroring `commitMergedPatternMaterial`)
 * instead of one independent region per surface — so "Merged" coherence mode
 * shows the cohesive combined pattern live, before the user ever clicks
 * "Apply Texture", not just after.
 */
export interface MeshPreviewMergeOptions {
  primarySurfaceId: string
  sharedBoundsWorld?: { min: Vector3; max: Vector3 }
}

/** Set all preview regions on one mesh at once (multi-select safe). */
export function syncMeshPreviewPatterns(
  mesh: Mesh,
  modelRoot: Object3D,
  previews: MeshPreviewTarget[],
  mergeOptions?: MeshPreviewMergeOptions,
): void {
  if (previews.length === 0) {
    removePreviewPattern(mesh, modelRoot)
    return
  }

  const state = ensureMeshState(mesh)
  const committed = state.regions.filter((r) => !isPreviewRegion(r.surfaceId))

  if (mergeOptions) {
    const triangleSet = new Set<number>()
    for (const { surface } of previews) {
      for (const t of resolveTriangleIndices(mesh, state, surface)) triangleSet.add(t)
    }

    const primary =
      previews.find((p) => p.surface.surfaceId === mergeOptions.primarySurfaceId) ?? previews[0]!

    const region: PatternRegion = {
      surfaceId: previewRegionId(mergeOptions.primarySurfaceId),
      triangleIndices: [...triangleSet],
      settings: { ...primary.settings },
      normal: primary.surface.normal.clone(),
      anchor: primary.surface.point.clone(),
      selectionType: primary.surface.selectionType,
      mappingMode: 'part',
      sharedBoundsWorld: mergeOptions.sharedBoundsWorld
        ? { min: mergeOptions.sharedBoundsWorld.min.clone(), max: mergeOptions.sharedBoundsWorld.max.clone() }
        : undefined,
    }

    state.regions = [...committed, region]
    rebuildMesh(mesh, modelRoot, state.regions)
    return
  }

  const seen = new Set<string>()
  const previewRegions: PatternRegion[] = []

  for (const { surface, settings } of previews) {
    if (seen.has(surface.surfaceId)) continue
    seen.add(surface.surfaceId)
    previewRegions.push(
      buildRegion(mesh, surface, settings, previewRegionId(surface.surfaceId)),
    )
  }

  state.regions = [...committed, ...previewRegions]
  rebuildMesh(mesh, modelRoot, state.regions)
}

export function removePreviewPattern(mesh: Mesh, modelRoot: Object3D): void {
  const state = meshStates.get(mesh.uuid)
  if (!state) return
  state.regions = state.regions.filter((r) => !isPreviewRegion(r.surfaceId))
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

/**
 * World-space AABB across a set of selected surfaces that may span *multiple
 * mesh objects* — e.g. a real assembly's "outside" is very often several
 * separate mesh bodies (Mini_Toolbox.3mf alone has 26), not one. A single
 * PatternRegion can only carry triangleIndices for one mesh's own geometry,
 * so a cross-mesh merge is unavoidably N regions (one per mesh) — but every
 * one of them can still reference this *same* combined bounds, so the cubic
 * mapping they all use scales and aligns identically instead of each mesh
 * getting its own, different reference frame (which is what made a
 * multi-mesh "merge" still look like independent per-part patterns).
 */
export function computeSharedWorldBounds(
  modelRoot: Object3D,
  surfaces: readonly SelectedSurface[],
): { min: Vector3; max: Vector3 } {
  const box = new Box3()
  const v = new Vector3()

  for (const surface of surfaces) {
    const mesh = findMeshByUuid(modelRoot, surface.meshUuid)
    if (!mesh) continue
    mesh.updateWorldMatrix(true, false)

    const state = ensureMeshState(mesh)
    const geo = state.pristineGeometry
    const pos = geo.getAttribute('position')
    const index = geo.index
    const triangleIndices = resolveTriangleIndices(mesh, state, surface)

    for (const t of triangleIndices) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k
        v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mesh.matrixWorld)
        box.expandByPoint(v)
      }
    }
  }

  if (box.isEmpty()) return { min: new Vector3(), max: new Vector3(1, 1, 1) }
  return { min: box.min.clone(), max: box.max.clone() }
}

/**
 * Commit one pattern across *multiple* selected surfaces on the same mesh as
 * a single cohesive region, instead of each surface getting its own
 * independent placement (which restarts/seams the pattern at every surface
 * boundary). The combined region's triangles are the union of every
 * surface's triangles, mapped with cubic/box mapping (`mappingMode: 'part'`)
 * — the same mechanism "Part" selections already use to map many
 * differently-oriented faces from one shared, continuous frame.
 *
 * Stored under `primarySurfaceId` (normally the active/last-clicked surface)
 * — the other selected surfaces' own surfaceIds are folded into this one
 * region rather than getting separate entries, so `committedSurfaceIds`
 * should track only `primarySurfaceId` for this group.
 *
 * `sharedBoundsWorld`, when given, overrides the region's own (mesh-local)
 * bounds — pass this when the overall merge spans multiple meshes so every
 * mesh's region shares one consistent cubic-mapping reference frame; see
 * `computeSharedWorldBounds`.
 */
export function commitMergedPatternMaterial(
  mesh: Mesh,
  modelRoot: Object3D,
  selectedSurfaces: SelectedSurface[],
  settings: SurfacePatternSettings,
  primarySurfaceId: string,
  sharedBoundsWorld?: { min: Vector3; max: Vector3 },
): void {
  if (selectedSurfaces.length === 0) return

  const state = ensureMeshState(mesh)
  const triangleSet = new Set<number>()
  for (const surface of selectedSurfaces) {
    for (const t of resolveTriangleIndices(mesh, state, surface)) triangleSet.add(t)
  }

  const primary =
    selectedSurfaces.find((s) => s.surfaceId === primarySurfaceId) ?? selectedSurfaces[0]!

  const region: PatternRegion = {
    surfaceId: primarySurfaceId,
    triangleIndices: [...triangleSet],
    settings: { ...settings },
    normal: primary.normal.clone(),
    anchor: primary.point.clone(),
    selectionType: primary.selectionType,
    mappingMode: 'part',
    sharedBoundsWorld: sharedBoundsWorld
      ? { min: sharedBoundsWorld.min.clone(), max: sharedBoundsWorld.max.clone() }
      : undefined,
  }

  const mergedIds = new Set(selectedSurfaces.map((s) => s.surfaceId))
  state.regions = state.regions.filter((r) => !mergedIds.has(r.surfaceId))
  state.regions.push(region)
  rebuildMesh(mesh, modelRoot, state.regions)
}

/**
 * Toggle whether `mesh`'s committed (applied) regions render invisible on
 * the original mesh — used by 3D Preview mode, which shows a real
 * geometry-displaced overlay in their place. In-progress (not-yet-applied)
 * preview regions on the same mesh are unaffected, so a surface being
 * actively edited keeps showing its normal 2D bump preview.
 */
export function setCommittedRegionsHiddenForMesh(
  modelRoot: Object3D,
  meshUuid: string,
  hidden: boolean,
): void {
  if (hidden) hiddenCommittedMeshes.add(meshUuid)
  else hiddenCommittedMeshes.delete(meshUuid)

  const mesh = findMeshByUuid(modelRoot, meshUuid)
  const state = meshStates.get(meshUuid)
  if (!mesh || !state) return
  rebuildMesh(mesh, modelRoot, state.regions)
}

/** True when `faceIndex` (pristine indexing) belongs to an already-committed (applied) region on `mesh`. */
export function isTriangleInCommittedRegion(mesh: Mesh, faceIndex: number): boolean {
  const state = meshStates.get(mesh.uuid)
  if (!state) return false
  for (const region of state.regions) {
    if (isPreviewRegion(region.surfaceId)) continue
    if (region.triangleIndices.includes(faceIndex)) return true
  }
  return false
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
  hiddenCommittedMeshes.delete(mesh.uuid)
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
