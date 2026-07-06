import type { BufferGeometry, Mesh } from 'three'

const pristineByMeshUuid = new Map<string, BufferGeometry>()

export function registerMeshPristineGeometry(meshUuid: string, geometry: BufferGeometry): void {
  pristineByMeshUuid.set(meshUuid, geometry)
}

export function unregisterMeshPristineGeometry(meshUuid: string): void {
  pristineByMeshUuid.delete(meshUuid)
}

export function getMeshPatternPristineGeometry(mesh: Mesh): BufferGeometry | undefined {
  return pristineByMeshUuid.get(mesh.uuid)
}

export function clearMeshPristineRegistry(): void {
  pristineByMeshUuid.clear()
}
