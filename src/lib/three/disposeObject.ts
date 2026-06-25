import type { BufferGeometry, Material, Object3D, Texture } from 'three'

export function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (!('isMesh' in child) || !child.isMesh) return

    const mesh = child as {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }

    mesh.geometry?.dispose()
    disposeMaterial(mesh.material)
  })
}

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (!material) return

  const materials = Array.isArray(material) ? material : [material]
  for (const mat of materials) {
    for (const value of Object.values(mat)) {
      if (value && typeof value === 'object' && 'isTexture' in value) {
        ;(value as Texture).dispose()
      }
    }
    mat.dispose()
  }
}
