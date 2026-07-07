import { Matrix4, Vector3, type BufferGeometry, type Mesh, type Object3D } from 'three'
import { ensureIndexedGeometry } from '../../geometry/ensureIndexedGeometry'
import { getMeshPatternPristineGeometry } from '../../materials/meshPatternRegistry'

const _v = new Vector3()
const _mat = new Matrix4()

/** userData flags that mark an object as non-exportable. */
export function isExportExcluded(object: Object3D): boolean {
  const d = object.userData
  return Boolean(
    d.excludeFromExport ||
      d.isPreview ||
      d.isPreviewTexture ||
      d.isSelectionOverlay ||
      d.isHelper,
  )
}

export function collectExportMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (isExportExcluded(object)) return
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return
    meshes.push(mesh)
  })
  return meshes
}

function resolveExportGeometry(mesh: Mesh): BufferGeometry {
  const pristine = getMeshPatternPristineGeometry(mesh)
  if (pristine) return pristine
  return ensureIndexedGeometry(mesh.geometry)
}

export interface MeshSoup {
  positions: Float32Array
  triangleCount: number
}

/**
 * Non-indexed triangle soup in world space, scaled to millimeters.
 * Each triangle occupies 9 floats (3 vertices × xyz).
 */
export function collectMeshTriangleSoup(mesh: Mesh, exportUnitScale: number): MeshSoup {
  mesh.updateMatrixWorld(true)
  const geometry = resolveExportGeometry(mesh)
  const pos = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triCount = index ? index.count / 3 : pos.count / 3
  const out = new Float32Array(triCount * 9)

  _mat.copy(mesh.matrixWorld)

  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(t * 3 + k) : t * 3 + k
      _v.fromBufferAttribute(pos, vi).applyMatrix4(_mat).multiplyScalar(exportUnitScale)
      const o = t * 9 + k * 3
      out[o] = _v.x
      out[o + 1] = _v.y
      out[o + 2] = _v.z
    }
  }

  return { positions: out, triangleCount: triCount }
}

export function appendMeshSoups(soups: readonly Float32Array[]): Float32Array {
  let total = 0
  for (const s of soups) total += s.length
  const merged = new Float32Array(total)
  let offset = 0
  for (const s of soups) {
    merged.set(s, offset)
    offset += s.length
  }
  return merged
}
