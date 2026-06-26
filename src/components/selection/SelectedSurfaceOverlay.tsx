import { DoubleSide } from 'three'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'

export function SelectedSurfaceOverlay() {
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)

  if (!selectedSurface) return null

  return (
    <mesh
      key={`${selectedSurface.meshUuid}-${selectedSurface.faceIndex}-${selectedSurface.triangleCount}`}
      geometry={selectedSurface.highlightGeometry}
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
