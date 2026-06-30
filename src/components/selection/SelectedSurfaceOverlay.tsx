import { useLayoutEffect, useRef } from 'react'
import { DoubleSide, type Mesh } from 'three'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { markIgnoreRaycast } from '../../lib/three/raycastUtils'

export function SelectedSurfaceOverlay() {
  const meshRef = useRef<Mesh>(null)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)

  useLayoutEffect(() => {
    if (meshRef.current) markIgnoreRaycast(meshRef.current)
  }, [selectedSurface?.surfaceId])

  if (!selectedSurface) return null

  return (
    <mesh
      ref={meshRef}
      key={`${selectedSurface.meshUuid}-${selectedSurface.faceIndex}-${selectedSurface.triangleCount}`}
      geometry={selectedSurface.highlightGeometry}
      userData={{ ignoreRaycast: true }}
      raycast={() => null}
      renderOrder={20}
    >
      <meshBasicMaterial
        color="#a78bfa"
        transparent
        opacity={0.55}
        depthTest
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        side={DoubleSide}
      />
    </mesh>
  )
}
