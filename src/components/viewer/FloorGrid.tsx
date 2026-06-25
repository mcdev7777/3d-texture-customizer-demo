import { useMemo } from 'react'
import { Grid, Plane } from '@react-three/drei'
import { useAppStore } from '../../store/useAppStore'

export function FloorGrid() {
  const showGrid = useAppStore((s) => s.viewerSettings.showGrid)

  const matColor = useMemo(() => '#1a3d2e', [])
  const sectionColor = useMemo(() => '#2d5a45', [])
  const cellColor = useMemo(() => '#234a38', [])

  if (!showGrid) return null

  return (
    <group position={[0, -0.01, 0]}>
      <Plane args={[20, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={matColor} roughness={0.95} metalness={0.05} />
      </Plane>
      <Grid
        args={[20, 20]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor={cellColor}
        sectionSize={2}
        sectionThickness={1.2}
        sectionColor={sectionColor}
        fadeDistance={18}
        fadeStrength={1.2}
        followCamera={false}
        infiniteGrid={false}
        position={[0, 0.001, 0]}
      />
    </group>
  )
}
