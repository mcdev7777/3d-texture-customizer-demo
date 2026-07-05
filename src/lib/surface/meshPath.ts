import type { Mesh, Object3D } from 'three'
import { findMeshByUuid } from './restoreSurfaceFromId'

function segmentName(node: Object3D): string {
  return node.name?.trim() || node.type
}

export function meshNameFromLabel(label: string): string | null {
  const sep = label.indexOf(' · ')
  if (sep <= 0) return null
  const name = label.slice(0, sep).trim()
  return name || null
}

export function findMeshByName(root: Object3D, name: string): Mesh | null {
  let found: Mesh | null = null
  root.traverse((child) => {
    if (found) return
    if ('isMesh' in child && child.isMesh && segmentName(child as Mesh) === name) {
      found = child as Mesh
    }
  })
  return found
}

/** Stable path from model root to mesh — survives reload when the same file is loaded. */
export function getMeshPath(mesh: Mesh, root: Object3D): string {
  const parts: string[] = []
  let node: Object3D | null = mesh

  while (node && node !== root) {
    const parent: Object3D | null = node.parent
    if (!parent) break

    const base = segmentName(node)
    const siblings = parent.children.filter((c: Object3D) => segmentName(c) === base)
    const idx = siblings.indexOf(node)
    parts.unshift(siblings.length > 1 ? `${base}#${idx}` : base)
    node = parent
  }

  return parts.join('/')
}

export function findMeshByPath(root: Object3D, path: string): Mesh | null {
  if (!path) return null

  let found: Mesh | null = null
  root.traverse((child) => {
    if (found) return
    if ('isMesh' in child && child.isMesh && getMeshPath(child as Mesh, root) === path) {
      found = child as Mesh
    }
  })
  return found
}

/** Index among all meshes in traversal order — stable for identical file loads. */
export function getMeshOrdinal(mesh: Mesh, root: Object3D): number {
  let ordinal = -1
  let i = 0
  root.traverse((child) => {
    if ('isMesh' in child && child.isMesh) {
      if (child === mesh) ordinal = i
      i++
    }
  })
  return ordinal
}

export function findMeshByOrdinal(root: Object3D, ordinal: number): Mesh | null {
  if (ordinal < 0) return null

  let found: Mesh | null = null
  let i = 0
  root.traverse((child) => {
    if (found) return
    if ('isMesh' in child && child.isMesh) {
      if (i === ordinal) found = child as Mesh
      i++
    }
  })
  return found
}

export function resolveMesh(
  root: Object3D,
  refs: { uuid?: string; meshPath?: string; meshOrdinal?: number; meshName?: string },
): Mesh | null {
  if (refs.meshPath) {
    const byPath = findMeshByPath(root, refs.meshPath)
    if (byPath) return byPath
  }

  if (refs.meshOrdinal !== undefined && refs.meshOrdinal >= 0) {
    const byOrdinal = findMeshByOrdinal(root, refs.meshOrdinal)
    if (byOrdinal) return byOrdinal
  }

  if (refs.meshName) {
    const byName = findMeshByName(root, refs.meshName)
    if (byName) return byName
  }

  if (refs.uuid) {
    return findMeshByUuid(root, refs.uuid)
  }

  return null
}
