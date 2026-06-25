import { useEffect } from 'react'
import type { Material, Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'

function supportsWireframe(material: Material): material is Material & { wireframe: boolean } {
  return 'wireframe' in material && typeof material.wireframe === 'boolean'
}

export function ModelRenderer() {
  const loadedModel = useAppStore((s) => s.loadedModel)
  const showWireframe = useAppStore((s) => s.viewerSettings.showWireframe)

  useEffect(() => {
    if (!loadedModel) return

    const originalWireframe = new Map<Material, boolean>()

    loadedModel.object.traverse((child) => {
      if (!('isMesh' in child) || !(child as Mesh).isMesh) return
      const mesh = child as Mesh
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

      for (const mat of materials) {
        if (!supportsWireframe(mat)) continue
        originalWireframe.set(mat, mat.wireframe)
        mat.wireframe = showWireframe
        mat.needsUpdate = true
      }
    })

    return () => {
      for (const [mat, wasWireframe] of originalWireframe) {
        if (!supportsWireframe(mat)) continue
        mat.wireframe = wasWireframe
        mat.needsUpdate = true
      }
    }
  }, [showWireframe, loadedModel])

  if (!loadedModel) return null

  return <primitive object={loadedModel.object} />
}
