import type { Object3D } from 'three'
import type { Mesh } from 'three'

/** Marker for meshes that must never participate in surface selection raycasts. */
export function markIgnoreRaycast(object: Object3D): void {
  object.userData.ignoreRaycast = true
  if ('raycast' in object) {
    ;(object as Mesh).raycast = () => {}
  }
}

export function isRaycastIgnored(object: Object3D): boolean {
  return object.userData?.ignoreRaycast === true
}
