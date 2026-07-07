import { Matrix4, Vector3, type Mesh, type Object3D } from 'three'

export interface CollectedGeometry {
  /** World-space vertex positions, flat: [x,y,z, …]. */
  vertices: number[]
  /** Triangle indices into `vertices`. */
  indices: number[]
}

const VERTEX_QUANT = 1e3

function packVertexKey(x: number, y: number, z: number): bigint {
  const ix = (Math.round(x * VERTEX_QUANT) + 0x100000) >>> 0
  const iy = (Math.round(y * VERTEX_QUANT) + 0x100000) >>> 0
  const iz = (Math.round(z * VERTEX_QUANT) + 0x100000) >>> 0
  return (BigInt(ix & 0x1fffff) << 42n) | (BigInt(iy & 0x1fffff) << 21n) | BigInt(iz & 0x1fffff)
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
 * world-space vertex/index buffer. Vertices are deduplicated by quantized position.
 */
export function collectExportableMeshes(root: Object3D): CollectedGeometry {
  root.updateMatrixWorld(true)

  const vertices: number[] = []
  const indices: number[] = []
  const vertexMap = new Map<bigint, number>()
  const v = new Vector3()
  const mat = new Matrix4()

  const getOrAddVertex = (x: number, y: number, z: number): number => {
    const key = packVertexKey(x, y, z)
    const existing = vertexMap.get(key)
    if (existing !== undefined) return existing
    const idx = vertices.length / 3
    vertices.push(x, y, z)
    vertexMap.set(key, idx)
    return idx
  }

  root.traverse((object) => {
    if (isExcluded(object)) {
      return
    }
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return

    const position = mesh.geometry.getAttribute('position')
    if (!position) return

    mat.copy(mesh.matrixWorld)

    const index = mesh.geometry.getIndex()
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = index.getX(i + k)
          v.fromBufferAttribute(position, vi).applyMatrix4(mat)
          indices.push(getOrAddVertex(v.x, v.y, v.z))
        }
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(position, i + k).applyMatrix4(mat)
          indices.push(getOrAddVertex(v.x, v.y, v.z))
        }
      }
    }
  })

  return { vertices, indices }
}
