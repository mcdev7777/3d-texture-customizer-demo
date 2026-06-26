import type { Mesh, Object3D } from 'three'

export function isMeshInModel(mesh: Mesh, modelRoot: Object3D | null): boolean {
  if (!modelRoot) return false
  let current: Object3D | null = mesh
  while (current) {
    if (current === modelRoot) return true
    current = current.parent
  }
  return false
}

export function clampFaceIndex(faceIndex: number, triangleCount: number): number {
  if (triangleCount <= 0) return 0
  return Math.min(Math.max(0, faceIndex), triangleCount - 1)
}
