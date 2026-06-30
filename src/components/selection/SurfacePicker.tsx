import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Raycaster, Vector2, Vector3, type Mesh, type Object3D } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { computeFaceNormal } from '../../lib/surface/computeFaceNormal'
import { getTriangleCount } from '../../lib/surface/geometryKeys'
import { clampFaceIndex, isMeshInModel } from '../../lib/surface/meshUtils'
import { isRaycastIgnored } from '../../lib/three/raycastUtils'

const _pointer = new Vector2()
const _point = new Vector3()
const _normal = new Vector3()
const DRAG_THRESHOLD_PX = 6

function isSelectableMesh(object: unknown, modelRoot: Object3D | null): object is Mesh {
  if (typeof object !== 'object' || object === null || !modelRoot) return false
  if (!('isMesh' in object) || !(object as Mesh).isMesh) return false
  const mesh = object as Mesh
  if (isRaycastIgnored(mesh)) return false
  if (!mesh.geometry?.getAttribute('position')) return false
  return isMeshInModel(mesh, modelRoot)
}

export function SurfacePicker() {
  const { camera, gl } = useThree()
  const raycaster = useRef(new Raycaster())
  const pointerDown = useRef<{ x: number; y: number; id: number } | null>(null)

  const loadedModel = useAppStore((s) => s.loadedModel)
  const enabled = useSurfaceSelectionStore((s) => s.enabled)
  const selectFromPick = useSurfaceSelectionStore((s) => s.selectFromPick)
  const setModelRoot = useSurfaceSelectionStore((s) => s.setModelRoot)

  useEffect(() => {
    setModelRoot(loadedModel?.object ?? null)
  }, [loadedModel, setModelRoot])

  useEffect(() => {
    if (!enabled || !loadedModel) return

    const canvas = gl.domElement
    raycaster.current.firstHitOnly = true

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointerDown.current = { x: event.clientX, y: event.clientY, id: event.pointerId }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      const start = pointerDown.current
      pointerDown.current = null
      if (!start || start.id !== event.pointerId) return

      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return

      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.current.setFromCamera(_pointer, camera)
      // Raycast only the loaded model subtree — overlays live on the scene root, not here.
      const hits = raycaster.current.intersectObject(loadedModel.object, true)

      const hit = hits.find((h) => isSelectableMesh(h.object, loadedModel.object))
      if (!hit || hit.faceIndex == null) return

      const mesh = hit.object as Mesh
      mesh.updateWorldMatrix(true, false)

      const triangleCount = getTriangleCount(mesh.geometry)
      const faceIndex = clampFaceIndex(hit.faceIndex, triangleCount)

      _point.copy(hit.point)
      computeFaceNormal(mesh.geometry, faceIndex, mesh, _normal)

      selectFromPick({
        mesh,
        faceIndex,
        point: _point.clone(),
        normal: _normal.clone(),
      })
    }

    const onPointerCancel = () => {
      pointerDown.current = null
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [enabled, loadedModel, camera, gl, selectFromPick])

  return null
}
