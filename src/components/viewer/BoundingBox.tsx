import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, Box3Helper } from 'three'
import type { Object3D } from 'three'
import { useAppStore } from '../../store/useAppStore'

interface BoundingBoxProps {
  object: Object3D | null
}

export function BoundingBox({ object }: BoundingBoxProps) {
  const showBoundingBox = useAppStore((s) => s.viewerSettings.showBoundingBox)

  if (!showBoundingBox || !object) return null

  return <BoundingBoxHelper object={object} />
}

function BoundingBoxHelper({ object }: { object: Object3D }) {
  const helperRef = useRef<Box3Helper | null>(null)
  const { scene } = useThree()

  useEffect(() => {
    const box = new Box3().setFromObject(object)
    const helper = new Box3Helper(box, 0xa78bfa)
    helperRef.current = helper
    scene.add(helper)

    return () => {
      scene.remove(helper)
      helperRef.current = null
    }
  }, [object, scene])

  useFrame(() => {
    const helper = helperRef.current
    if (!helper) return
    helper.box.setFromObject(object)
  })

  return null
}
