import { Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three'
import type { SelectedSurface, SelectionMode } from '../../types/surfaceSelection'
import { computeFaceNormal, getTriangleVertexIndices } from './computeFaceNormal'
import { clampFaceIndex, isMeshInModel } from './meshUtils'
import { getTriangleCount } from './geometryKeys'
import { getConnectedCoplanarSurface } from './getConnectedCoplanarSurface'
import { getAllMeshFaces, getFacesByAngle } from './selectByAngle'
import { buildSelectedSurfaceGeometry } from './buildSelectedSurfaceGeometry'
import { computeSurfaceArea } from './computeTriangleArea'
import { getSurfaceId } from './getSurfaceId'
import { getMeshPatternPristineGeometry } from '../materials/meshPatternRegistry'
import { mapLiveFaceIndexToPristine } from './mapFaceToPristine'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

const _point = new Vector3()

export function parseSurfaceId(surfaceId: string): { meshUuid: string; faceIndex: number } | null {
  const sep = surfaceId.lastIndexOf(':')
  if (sep <= 0) return null
  const faceIndex = Number.parseInt(surfaceId.slice(sep + 1), 10)
  if (!Number.isFinite(faceIndex)) return null
  return { meshUuid: surfaceId.slice(0, sep), faceIndex }
}

export function findMeshByUuid(root: Object3D, uuid: string): Mesh | null {
  let found: Mesh | null = null
  root.traverse((child) => {
    if (found) return
    if (child.uuid === uuid && 'isMesh' in child && child.isMesh) {
      found = child as Mesh
    }
  })
  return found
}

function getFaceWorldCenter(
  mesh: Mesh,
  faceIndex: number,
  sourceGeometry: BufferGeometry,
  target: Vector3,
): void {
  const position = sourceGeometry.getAttribute('position')
  const clamped = clampFaceIndex(faceIndex, getTriangleCount(sourceGeometry))
  const [ia, ib, ic] = getTriangleVertexIndices(sourceGeometry, clamped)

  target.set(0, 0, 0)
  for (const index of [ia, ib, ic]) {
    _point.fromBufferAttribute(position, index)
    target.add(_point)
  }
  target.divideScalar(3)
  mesh.updateWorldMatrix(true, false)
  target.applyMatrix4(mesh.matrixWorld)
}

function selectionModeForSurfaceId(faceIndex: number): SelectionMode {
  return faceIndex === -1 ? 'part' : 'surface'
}

function buildSurfaceFromPick(
  mesh: Mesh,
  faceIndex: number,
  selectionMode: SelectionMode,
  modelRoot: Object3D,
): SelectedSurface | null {
  const { angleTolerance, connectedOnly } = useSurfaceSelectionStore.getState()

  mesh.updateWorldMatrix(true, false)
  const geometry = mesh.geometry
  const pristineGeometry = getMeshPatternPristineGeometry(mesh)
  const indexGeometry = pristineGeometry ?? geometry
  const clampedFace = clampFaceIndex(faceIndex, getTriangleCount(indexGeometry))

  let triangleIndices: number[]
  if (selectionMode === 'part') {
    triangleIndices = getAllMeshFaces(indexGeometry)
  } else if (connectedOnly) {
    triangleIndices = getConnectedCoplanarSurface(indexGeometry, mesh, clampedFace, angleTolerance)
  } else {
    triangleIndices = getFacesByAngle(indexGeometry, mesh, clampedFace, angleTolerance)
  }

  const highlightGeometry = buildSelectedSurfaceGeometry(
    geometry,
    mesh,
    triangleIndices,
    modelRoot,
  )
  if (highlightGeometry.getAttribute('position').count === 0) {
    highlightGeometry.dispose()
    return null
  }

  getFaceWorldCenter(mesh, clampedFace, indexGeometry, _point)
  const normal = computeFaceNormal(indexGeometry, clampedFace, mesh)
  const area = computeSurfaceArea(indexGeometry, mesh, triangleIndices)
  const surfaceId =
    selectionMode === 'part'
      ? getSurfaceId(mesh.uuid, -1)
      : getSurfaceId(mesh.uuid, clampedFace)

  return {
    surfaceId,
    meshUuid: mesh.uuid,
    meshName: mesh.name || 'Mesh',
    faceIndex: selectionMode === 'part' ? clampedFace : clampedFace,
    selectionType: selectionMode,
    point: _point.clone(),
    normal: normal.clone(),
    triangleIndices,
    triangleCount: triangleIndices.length,
    area,
    highlightGeometry,
  }
}

/** Build a surface descriptor for apply/restore without updating selection UI state. */
export function buildSelectedSurfaceFromId(
  surfaceId: string,
  modelRoot: Object3D,
): SelectedSurface | null {
  const parsed = parseSurfaceId(surfaceId)
  if (!parsed) return null

  const mesh = findMeshByUuid(modelRoot, parsed.meshUuid)
  if (!mesh || !isMeshInModel(mesh, modelRoot)) return null

  const selectionMode = selectionModeForSurfaceId(parsed.faceIndex)
  const pristine = getMeshPatternPristineGeometry(mesh)
  const seedFace =
    selectionMode === 'part'
      ? 0
      : pristine
        ? mapLiveFaceIndexToPristine(
            mesh,
            pristine,
            clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry)),
          )
        : clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry))

  return buildSurfaceFromPick(mesh, seedFace, selectionMode, modelRoot)
}

/** Re-select a surface by id when the same model is loaded (best-effort). */
export function restoreSurfaceSelection(surfaceId: string | undefined, modelRoot: Object3D | null): void {
  if (!surfaceId || !modelRoot) return

  const parsed = parseSurfaceId(surfaceId)
  if (!parsed) return

  const mesh = findMeshByUuid(modelRoot, parsed.meshUuid)
  if (!mesh || !isMeshInModel(mesh, modelRoot)) return

  const selectionMode = selectionModeForSurfaceId(parsed.faceIndex)
  if (selectionMode === 'part') {
    useSurfaceSelectionStore.setState({ selectionMode: 'part' })
  }

  const seedFace =
    selectionMode === 'part'
      ? 0
      : (() => {
          const pristine = getMeshPatternPristineGeometry(mesh)
          if (pristine) {
            return mapLiveFaceIndexToPristine(
              mesh,
              pristine,
              clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry)),
            )
          }
          return clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry))
        })()

  getFaceWorldCenter(mesh, seedFace, getMeshPatternPristineGeometry(mesh) ?? mesh.geometry, _point)
  const indexGeo = getMeshPatternPristineGeometry(mesh) ?? mesh.geometry
  const normal = computeFaceNormal(indexGeo, seedFace, mesh)

  useSurfaceSelectionStore.getState().selectFromPick({
    mesh,
    faceIndex:
      selectionMode === 'part'
        ? seedFace
        : clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry)),
    point: _point.clone(),
    normal,
  })
}
