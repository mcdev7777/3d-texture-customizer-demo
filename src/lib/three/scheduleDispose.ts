import type { Mesh, Object3D } from 'three'
import { disposeObject } from './disposeObject'

/** Dispose after the current frame so React/R3F can detach the object first. */
export function scheduleDisposeObject(object: Object3D | null | undefined): void {
  if (!object) return
  queueMicrotask(() => disposeObject(object))
}

export function disposeExportCloneGeometries(object: Object3D): void {
  object.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return
    const mesh = child as Mesh
    mesh.geometry?.dispose()
  })
}
