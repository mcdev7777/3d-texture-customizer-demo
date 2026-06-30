import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { DoubleSide, PlaneGeometry, Quaternion, Vector3, type Mesh } from 'three'
import { usePatternStore } from '../../store/usePatternStore'
import { clonePatternTexture } from '../../utils/patternTextures'
import { markIgnoreRaycast } from '../../lib/three/raycastUtils'
import type { SurfacePatternPlacement } from '../../types/pattern'

function PatternPlane({ placement }: { placement: SurfacePatternPlacement }) {
  const meshRef = useRef<Mesh>(null)
  const { settings, plane, surfaceId } = placement
  const patternId = settings.patternId!

  const texture = useMemo(
    () => clonePatternTexture(patternId),
    [patternId, surfaceId],
  )

  const geometry = useMemo(
    () => new PlaneGeometry(plane.width, plane.height),
    [plane.width, plane.height, surfaceId],
  )

  const position = useMemo(() => {
    const pos = new Vector3(...plane.center)
    const normal = new Vector3(...plane.normal)
    const lift = settings.mode === 'emboss' ? settings.depth : -settings.depth * 0.4
    return pos.addScaledVector(normal, lift + 0.003)
  }, [plane.center, plane.normal, settings.mode, settings.depth])

  const quaternion = useMemo(
    () => new Quaternion(...plane.quaternion),
    [plane.quaternion],
  )

  useEffect(() => {
    const repeat = Math.max(0.25, settings.scale) * 2
    texture.repeat.set(repeat, repeat)
    texture.center.set(0.5, 0.5)
    texture.rotation = (settings.rotation * Math.PI) / 180
    texture.offset.set(settings.offsetX * 0.35, -settings.offsetY * 0.35)
    texture.needsUpdate = true
  }, [texture, settings.scale, settings.rotation, settings.offsetX, settings.offsetY])

  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    if (meshRef.current) markIgnoreRaycast(meshRef.current)
  }, [surfaceId])

  const isEmboss = settings.mode === 'emboss'
  const depth = Math.max(0, settings.depth)

  return (
    <mesh
      ref={meshRef}
      position={position}
      quaternion={quaternion}
      geometry={geometry}
      userData={{ ignoreRaycast: true }}
      raycast={() => null}
      renderOrder={15}
    >
      <meshStandardMaterial
        map={texture}
        transparent
        opacity={settings.opacity * (isEmboss ? 0.9 : 0.85)}
        color={isEmboss ? '#f5f3ff' : '#1e1b4b'}
        emissive={isEmboss ? '#8b5cf6' : '#020617'}
        emissiveIntensity={isEmboss ? depth * 6 + 0.05 : depth * 4 + 0.02}
        roughness={isEmboss ? Math.max(0.15, 0.35 - depth) : Math.min(0.95, 0.75 + depth * 2)}
        metalness={isEmboss ? 0.2 : 0.02}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
        side={DoubleSide}
      />
    </mesh>
  )
}

export function SurfacePatternOverlay() {
  const placements = usePatternStore((s) => s.placements)

  const active = useMemo(
    () => Object.values(placements).filter((p) => p.settings.patternId !== null),
    [placements],
  )

  return (
    <>
      {active.map((placement) => (
        <PatternPlane key={placement.surfaceId} placement={placement} />
      ))}
    </>
  )
}
