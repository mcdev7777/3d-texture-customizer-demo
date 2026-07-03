import { BufferGeometry, Matrix4, Quaternion, Vector3 } from 'three'
import type { SurfacePlaneData } from '../../types/pattern'

/**
 * A stable local 2D coordinate frame for a selected surface, derived from the
 * selected triangles (in world space) and the seed face normal.
 *
 * tangent (X), bitangent (Y), and normal (Z) form a right-handed orthonormal
 * basis so the same frame can be used to position a patch and to map UVs.
 * Both Preview Texture and Apply Texture build geometry from this projection,
 * guaranteeing identical placement.
 */
export interface SurfaceProjection {
  originWorld: Vector3
  normalWorld: Vector3
  tangentWorld: Vector3
  bitangentWorld: Vector3
  minU: number
  maxU: number
  minV: number
  maxV: number
  width: number
  height: number
}

const MIN_EXTENT = 0.05
const _v = new Vector3()
const _basis = new Matrix4()

/**
 * Build a surface projection from the world-space highlight geometry of the
 * current selection plus the seed face normal (already in world space).
 */
export function createSurfaceProjectionFromHighlight(
  highlightGeometry: BufferGeometry,
  worldNormal: Vector3,
  fallbackCenter?: Vector3,
): SurfaceProjection {
  const position = highlightGeometry.getAttribute('position')
  const count = position ? position.count : 0

  const normalWorld = worldNormal.clone()
  if (normalWorld.lengthSq() === 0) normalWorld.set(0, 0, 1)
  normalWorld.normalize()

  // In-plane tangent: project a world up/right axis onto the surface plane.
  const tangentWorld = new Vector3(0, 1, 0)
  if (Math.abs(normalWorld.dot(tangentWorld)) > 0.92) {
    tangentWorld.set(1, 0, 0)
  }
  tangentWorld.crossVectors(tangentWorld, normalWorld).normalize()
  // bitangent = normal × tangent → (tangent, bitangent, normal) is right-handed.
  const bitangentWorld = new Vector3().crossVectors(normalWorld, tangentWorld).normalize()

  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  let sumN = 0

  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(position, i)
    const u = _v.dot(tangentWorld)
    const vv = _v.dot(bitangentWorld)
    sumN += _v.dot(normalWorld)
    if (u < minU) minU = u
    if (u > maxU) maxU = u
    if (vv < minV) minV = vv
    if (vv > maxV) maxV = vv
  }

  if (count === 0) {
    // Degenerate selection — anchor a tiny frame at the fallback point.
    const anchor = fallbackCenter ?? new Vector3()
    minU = maxU = anchor.dot(tangentWorld)
    minV = maxV = anchor.dot(bitangentWorld)
    sumN = anchor.dot(normalWorld)
  }

  const midU = (minU + maxU) / 2
  const midV = (minV + maxV) / 2
  const dN = count > 0 ? sumN / count : sumN

  // Reconstruct the bounds-center point that lies on the surface plane.
  const originWorld = new Vector3()
    .addScaledVector(tangentWorld, midU)
    .addScaledVector(bitangentWorld, midV)
    .addScaledVector(normalWorld, dN)

  return {
    originWorld,
    normalWorld,
    tangentWorld,
    bitangentWorld,
    minU,
    maxU,
    minV,
    maxV,
    width: Math.max(maxU - minU, MIN_EXTENT),
    height: Math.max(maxV - minV, MIN_EXTENT),
  }
}

/**
 * Convert a projection into the SurfacePlaneData consumed by the patch builder.
 * The quaternion maps the patch's local +X → tangent, +Y → bitangent, +Z → normal,
 * so a PlaneGeometry's width/height line up exactly with the measured bounds.
 */
export function surfacePlaneFromProjection(projection: SurfaceProjection): SurfacePlaneData {
  _basis.makeBasis(projection.tangentWorld, projection.bitangentWorld, projection.normalWorld)
  const quat = new Quaternion().setFromRotationMatrix(_basis)
  return {
    center: [projection.originWorld.x, projection.originWorld.y, projection.originWorld.z],
    normal: [projection.normalWorld.x, projection.normalWorld.y, projection.normalWorld.z],
    width: projection.width,
    height: projection.height,
    quaternion: [quat.x, quat.y, quat.z, quat.w],
  }
}
