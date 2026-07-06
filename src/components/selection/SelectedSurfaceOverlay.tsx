import { useLayoutEffect, useRef } from 'react'
import { DoubleSide, type Mesh } from 'three'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { markIgnoreRaycast } from '../../lib/three/raycastUtils'
import {
  SELECTION_HIGHLIGHT_ACTIVE_COLOR,
  SELECTION_HIGHLIGHT_ACTIVE_OPACITY,
  SELECTION_HIGHLIGHT_COLOR,
  SELECTION_HIGHLIGHT_OPACITY,
} from '../../lib/surface/selectionHighlight'

function HighlightMesh({
  surface,
  active,
}: {
  surface: {
    surfaceId: string
    meshUuid: string
    faceIndex: number
    triangleCount: number
    highlightGeometry: Mesh['geometry']
  }
  active: boolean
}) {
  const meshRef = useRef<Mesh>(null)

  useLayoutEffect(() => {
    if (meshRef.current) markIgnoreRaycast(meshRef.current)
  }, [surface.surfaceId])

  return (
    <mesh
      ref={meshRef}
      key={`${surface.meshUuid}-${surface.faceIndex}-${surface.triangleCount}-${active ? 'active' : 'idle'}`}
      geometry={surface.highlightGeometry}
      userData={{ ignoreRaycast: true }}
      raycast={() => null}
      renderOrder={active ? 21 : 20}
    >
      <meshBasicMaterial
        color={active ? SELECTION_HIGHLIGHT_ACTIVE_COLOR : SELECTION_HIGHLIGHT_COLOR}
        transparent
        opacity={active ? SELECTION_HIGHLIGHT_ACTIVE_OPACITY : SELECTION_HIGHLIGHT_OPACITY}
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

export function SelectedSurfaceOverlay() {
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)
  const activeSurfaceId = useSurfaceSelectionStore((s) => s.activeSurfaceId)

  if (selectedSurfaces.length === 0) return null

  return (
    <>
      {selectedSurfaces.map((surface) => (
        <HighlightMesh
          key={surface.surfaceId}
          surface={surface}
          active={surface.surfaceId === activeSurfaceId}
        />
      ))}
    </>
  )
}
