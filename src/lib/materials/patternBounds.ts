import { Box3, Vector3, type BufferGeometry, type Mesh } from 'three'

export interface PatternBounds {
  min: Vector3
  max: Vector3
  center: Vector3
  size: Vector3
}

const _box = new Box3()
const _v = new Vector3()

/** World-space AABB for a mesh or a subset of its triangles. */
export function computePatternBounds(
  mesh: Mesh,
  sourceGeometry: BufferGeometry,
  triangleIndices?: readonly number[],
): PatternBounds {
  mesh.updateWorldMatrix(true, false)
  _box.makeEmpty()

  const pos = sourceGeometry.getAttribute('position')
  const index = sourceGeometry.index

  if (triangleIndices && triangleIndices.length > 0) {
    for (const t of triangleIndices) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k
        _v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mesh.matrixWorld)
        _box.expandByPoint(_v)
      }
    }
  } else {
    _box.setFromObject(mesh)
  }

  if (_box.isEmpty()) _box.setFromObject(mesh)

  const min = _box.min.clone()
  const max = _box.max.clone()
  const center = _box.getCenter(new Vector3())
  const size = _box.getSize(new Vector3())
  size.x = Math.max(size.x, 1e-4)
  size.y = Math.max(size.y, 1e-4)
  size.z = Math.max(size.z, 1e-4)

  return { min, max, center, size }
}
