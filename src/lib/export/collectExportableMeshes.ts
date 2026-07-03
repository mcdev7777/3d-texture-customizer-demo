import { Matrix4, Vector3, type Mesh, type Object3D } from 'three'

export interface CollectedGeometry {
  /** World-space vertex positions, flat: [x,y,z, …]. */
  vertices: number[]
  /** Triangle indices into `vertices`. */
  indices: number[]
}

/** userData flags that mark an object as non-exportable (helpers/preview/selection). */
function isExcluded(object: Object3D): boolean {
  const d = object.userData
  return Boolean(
    d.excludeFromExport ||
      d.isPreview ||
      d.isPreviewTexture ||
      d.isSelectionOverlay ||
      d.isHelper,
  )
}

/**
 * Collect all exportable mesh geometry from an object tree, merged into a single
 * world-space vertex/index buffer. Preview/selection/helper objects and anything
 * flagged non-exportable (or hidden) are skipped.
 */
export function collectExportableMeshes(root: Object3D): CollectedGeometry {
  root.updateMatrixWorld(true)

  const vertices: number[] = []
  const indices: number[] = []
  const v = new Vector3()
  const mat = new Matrix4()

  root.traverse((object) => {
    if (isExcluded(object)) {
      // Skip this object; children are still traversed but also flag-checked.
      return
    }
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return

    const position = mesh.geometry.getAttribute('position')
    if (!position) return

    mat.copy(mesh.matrixWorld)
    const baseIndex = vertices.length / 3

    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mat)
      vertices.push(v.x, v.y, v.z)
    }

    const index = mesh.geometry.getIndex()
    if (index) {
      for (let i = 0; i < index.count; i++) {
        indices.push(baseIndex + index.getX(i))
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices.push(baseIndex + i)
      }
    }
  })

  return { vertices, indices }
}
