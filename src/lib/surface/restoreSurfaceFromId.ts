import type { Mesh, Object3D } from 'three'

export function parseSurfaceId(surfaceId: string): { meshUuid: string; faceIndex: number } | null {
  const sep = surfaceId.lastIndexOf(':')
  if (sep <= 0) return null
  const faceIndex = Number.parseInt(surfaceId.slice(sep + 1), 10)
  if (!Number.isFinite(faceIndex)) return null
  return { meshUuid: surfaceId.slice(0, sep), faceIndex }
}

export function findMeshByUuid(root: Object3D, uuid: string): Mesh | null {
  let found: Mesh | null = null
  root.traverse((child) => {
    if (found) return
    if (child.uuid === uuid && 'isMesh' in child && child.isMesh) {
      found = child as Mesh
    }
  })
  return found
}
