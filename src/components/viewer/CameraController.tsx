import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls as DreiOrbitControls } from '@react-three/drei'
import type { OrbitControls } from 'three-stdlib'
import type { PerspectiveCamera } from 'three'
import { useAppStore } from '../../store/useAppStore'
import {
  EMPTY_SCENE_CAMERA,
  fitCameraToObject,
  getDefaultCameraPosition,
} from '../../lib/three/fitCameraToObject'

// Camera polar angle (radians, measured from the up axis) beyond which the
// camera looks up at the model's underside; the grid is hidden past this so
// it doesn't block the bottom view.
const BOTTOM_VIEW_POLAR_ANGLE = Math.PI * 0.55

export function CameraController() {
  const controlsRef = useRef<OrbitControls>(null)
  const { camera } = useThree()
  const setCameraActions = useAppStore((s) => s.setCameraActions)
  const setIsBottomView = useAppStore((s) => s.setIsBottomView)
  const loadedModel = useAppStore((s) => s.loadedModel)
  const lastFittedModelId = useRef<string | null>(null)

  useEffect(() => {
    const perspCamera = camera as PerspectiveCamera
    perspCamera.up.set(0, 0, 1)
  }, [camera])

  useEffect(() => {
    const controls = controlsRef.current
    const perspCamera = camera as PerspectiveCamera
    if (!controls) return

    const reset = () => {
      perspCamera.up.set(0, 0, 1)
      const { position, target } = loadedModel
        ? getDefaultCameraPosition(loadedModel.object)
        : EMPTY_SCENE_CAMERA

      perspCamera.position.copy(position)
      controls.target.copy(target)
      perspCamera.near = 0.01
      perspCamera.far = 1000
      perspCamera.updateProjectionMatrix()
      controls.update()
    }

    const fit = () => {
      if (!loadedModel) return
      fitCameraToObject(perspCamera, controls, loadedModel.object)
    }

    setCameraActions({ reset, fit })

    return () => {
      setCameraActions(null)
      setIsBottomView(false)
    }
  }, [camera, loadedModel, setCameraActions, setIsBottomView])

  useEffect(() => {
    const controls = controlsRef.current
    const perspCamera = camera as PerspectiveCamera
    if (!controls || !loadedModel) {
      lastFittedModelId.current = null
      return
    }

    const modelId = loadedModel.object.uuid
    if (lastFittedModelId.current === modelId) return

    lastFittedModelId.current = modelId
    fitCameraToObject(perspCamera, controls, loadedModel.object)
  }, [loadedModel, camera])

  const handleControlsChange = () => {
    const controls = controlsRef.current
    if (!controls) return
    setIsBottomView(controls.getPolarAngle() > BOTTOM_VIEW_POLAR_ANGLE)
  }

  return (
    <DreiOrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.5}
      maxDistance={150}
      maxPolarAngle={Math.PI}
      onChange={handleControlsChange}
    />
  )
}
