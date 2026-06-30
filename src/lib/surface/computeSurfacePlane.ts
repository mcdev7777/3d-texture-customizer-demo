import { BufferGeometry, Quaternion, Vector3 } from 'three'
import type { SurfacePlaneData } from '../../types/pattern'

const _center = new Vector3()
const _vertex = new Vector3()
const _normal = new Vector3()
const _tangent = new Vector3()
const _bitangent = new Vector3()
const _quat = new Quaternion()

export function computeSurfacePlaneFromHighlight(
  highlightGeometry: BufferGeometry,
  worldNormal: Vector3,
  fallbackCenter?: Vector3,
): SurfacePlaneData {
  const position = highlightGeometry.getAttribute('position')
  _normal.copy(worldNormal).normalize()

  _tangent.set(0, 1, 0)
  if (Math.abs(_normal.dot(_tangent)) > 0.92) {
    _tangent.set(1, 0, 0)
  }
  _tangent.cross(_normal).normalize()
  _bitangent.crossVectors(_normal, _tangent).normalize()

  _center.set(0, 0, 0)
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity

  for (let i = 0; i < position.count; i++) {
    _vertex.fromBufferAttribute(position, i)
    _center.add(_vertex)

    const u = _vertex.dot(_tangent)
    const v = _vertex.dot(_bitangent)
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }

  if (position.count > 0) {
    _center.divideScalar(position.count)
  } else if (fallbackCenter) {
    _center.copy(fallbackCenter)
  }

  const width = Math.max(maxU - minU, 0.05)
  const height = Math.max(maxV - minV, 0.05)

  _quat.setFromUnitVectors(new Vector3(0, 0, 1), _normal)

  return {
    center: [_center.x, _center.y, _center.z],
    normal: [_normal.x, _normal.y, _normal.z],
    width,
    height,
    quaternion: [_quat.x, _quat.y, _quat.z, _quat.w],
  }
}
