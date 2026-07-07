import { Box3, Vector3, type Mesh, type Object3D } from 'three'
import type { EngineBounds } from '../exportPipeline'

const _box = new Box3()
const _v = new Vector3()

function toPlain(v: Vector3): { x: number; y: number; z: number } {
  return { x: v.x, y: v.y, z: v.z }
}

/** Structured-clone-safe AABB from mm-space triangle soup positions. */
export function computeEngineBounds(positions: Float32Array): EngineBounds {
  _box.makeEmpty()
  for (let i = 0; i < positions.length; i += 3) {
    _v.set(positions[i]!, positions[i + 1]!, positions[i + 2]!)
    _box.expandByPoint(_v)
  }
  if (_box.isEmpty()) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
      size: { x: 1, y: 1, z: 1 },
      center: { x: 0.5, y: 0.5, z: 0.5 },
    }
  }
  const min = _box.min.clone()
  const max = _box.max.clone()
  const center = _box.getCenter(new Vector3())
  const size = _box.getSize(new Vector3())
  return { min: toPlain(min), max: toPlain(max), size: toPlain(size), center: toPlain(center) }
}

/** Bounds from a mesh subtree (world space, before unit-scale multiply). */
export function computeMeshRootBounds(root: Object3D, exportUnitScale: number): EngineBounds {
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  if (_box.isEmpty()) {
    return computeEngineBounds(new Float32Array([0, 0, 0, 1, 1, 1]))
  }
  const min = _box.min.clone().multiplyScalar(exportUnitScale)
  const max = _box.max.clone().multiplyScalar(exportUnitScale)
  const center = _box.getCenter(new Vector3()).multiplyScalar(exportUnitScale)
  const size = _box.getSize(new Vector3()).multiplyScalar(exportUnitScale)
  return { min: toPlain(min), max: toPlain(max), size: toPlain(size), center: toPlain(center) }
}

export function computeMeshBounds(mesh: Mesh, exportUnitScale: number): EngineBounds {
  mesh.updateMatrixWorld(true)
  _box.setFromObject(mesh)
  const min = _box.min.clone().multiplyScalar(exportUnitScale)
  const max = _box.max.clone().multiplyScalar(exportUnitScale)
  const center = _box.getCenter(new Vector3()).multiplyScalar(exportUnitScale)
  const size = _box.getSize(new Vector3()).multiplyScalar(exportUnitScale)
  return { min: toPlain(min), max: toPlain(max), size: toPlain(size), center: toPlain(center) }
}
