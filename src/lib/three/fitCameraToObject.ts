import { Box3, Vector3 } from 'three'
import type { Object3D, PerspectiveCamera } from 'three'
import type { OrbitControls } from 'three-stdlib'

const FIT_PADDING = 1.35

export function fitCameraToObject(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Object3D,
): void {
  camera.up.set(0, 0, 1)

  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) return

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)

  const fovRad = (camera.fov * Math.PI) / 180
  const distance = (maxDim / 2 / Math.tan(fovRad / 2)) * FIT_PADDING

  camera.position.set(
    center.x + distance * 0.65,
    center.y + distance * 0.65,
    center.z + distance * 0.85,
  )
  camera.near = Math.max(distance / 200, 0.01)
  camera.far = Math.max(distance * 200, 1000)
  camera.updateProjectionMatrix()

  controls.target.copy(center)
  controls.update()
}

export function getDefaultCameraPosition(object: Object3D | null): {
  position: Vector3
  target: Vector3
} {
  if (!object) {
    return {
      position: new Vector3(5, 5, 4),
      target: new Vector3(0, 0, 0),
    }
  }

  const box = new Box3().setFromObject(object)
  const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3())
  const size = box.isEmpty() ? new Vector3(5, 5, 5) : box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)

  return {
    position: new Vector3(
      center.x + maxDim * 1.25,
      center.y + maxDim * 1.25,
      center.z + maxDim * 0.85,
    ),
    target: center.clone(),
  }
}

export const EMPTY_SCENE_CAMERA = {
  position: new Vector3(5, 5, 4),
  target: new Vector3(0, 0, 0),
}
