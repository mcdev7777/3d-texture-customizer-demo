import { Vector3, type Mesh, type Object3D } from 'three'
import { computeFaceNormal, getTriangleVertexIndices } from './computeFaceNormal'
import { clampFaceIndex, isMeshInModel } from './meshUtils'
import { getTriangleCount } from './geometryKeys'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

const _point = new Vector3()

export function parseSurfaceId(surfaceId: string): { meshUuid: string; faceIndex: number } | null {
  const sep = surfaceId.lastIndexOf(':')
  if (sep <= 0) return null
  const faceIndex = Number.parseInt(surfaceId.slice(sep + 1), 10)
  if (!Number.isFinite(faceIndex) || faceIndex < 0) return null
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

function getFaceWorldCenter(mesh: Mesh, faceIndex: number, target: Vector3): void {
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  const clamped = clampFaceIndex(faceIndex, getTriangleCount(geometry))
  const [ia, ib, ic] = getTriangleVertexIndices(geometry, clamped)

  target.set(0, 0, 0)
  for (const index of [ia, ib, ic]) {
    _point.fromBufferAttribute(position, index)
    target.add(_point)
  }
  target.divideScalar(3)
  mesh.updateWorldMatrix(true, false)
  target.applyMatrix4(mesh.matrixWorld)
}

/** Re-select a surface by id when the same model is loaded (best-effort). */
export function restoreSurfaceSelection(surfaceId: string | undefined, modelRoot: Object3D | null): void {
  if (!surfaceId || !modelRoot) return

  const parsed = parseSurfaceId(surfaceId)
  if (!parsed) return

  const mesh = findMeshByUuid(modelRoot, parsed.meshUuid)
  if (!mesh || !isMeshInModel(mesh, modelRoot)) return

  mesh.updateWorldMatrix(true, false)
  const faceIndex = clampFaceIndex(parsed.faceIndex, getTriangleCount(mesh.geometry))
  getFaceWorldCenter(mesh, faceIndex, _point)
  const normal = computeFaceNormal(mesh.geometry, faceIndex, mesh)

  useSurfaceSelectionStore.getState().selectFromPick({
    mesh,
    faceIndex,
    point: _point.clone(),
    normal,
  })
}
