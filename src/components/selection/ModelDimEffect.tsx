import { useEffect } from 'react'
import type { Material, Mesh } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

const DIM_OPACITY = 0.35

export function ModelDimEffect() {
  const loadedModel = useAppStore((s) => s.loadedModel)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const enabled = useSurfaceSelectionStore((s) => s.enabled)

  const shouldDim = enabled && selectedSurface !== null
  const selectedMeshUuid = selectedSurface?.meshUuid ?? null

  useEffect(() => {
    if (!loadedModel) return

    const originalState = new Map<Material, { opacity: number; transparent: boolean }>()

    loadedModel.object.traverse((child) => {
      if (!('isMesh' in child) || !(child as Mesh).isMesh) return
      const mesh = child as Mesh
      const skipDim = shouldDim && mesh.uuid === selectedMeshUuid
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

      for (const mat of materials) {
        if (!originalState.has(mat)) {
          originalState.set(mat, { opacity: mat.opacity, transparent: mat.transparent })
        }

        if (shouldDim && !skipDim) {
          mat.transparent = true
          mat.opacity = DIM_OPACITY
        } else {
          const original = originalState.get(mat)!
          mat.opacity = original.opacity
          mat.transparent = original.transparent
        }
        mat.needsUpdate = true
      }
    })

    return () => {
      for (const [mat, state] of originalState) {
        mat.opacity = state.opacity
        mat.transparent = state.transparent
        mat.needsUpdate = true
      }
    }
  }, [loadedModel, shouldDim, selectedMeshUuid])

  return null
}
