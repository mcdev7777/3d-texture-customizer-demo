import { Box3 } from 'three'
import type { BufferGeometry, Mesh, Object3D } from 'three'
import type { ModelDimensions, ModelStats } from '../../types/model'

function countTriangles(geometry: BufferGeometry): number {
  const index = geometry.index
  if (index) {
    return Math.floor(index.count / 3)
  }
  const position = geometry.getAttribute('position')
  if (!position) return 0
  return Math.floor(position.count / 3)
}

function countVertices(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  return position ? position.count : 0
}

function roundDimension(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function computeModelStats(object: Object3D): ModelStats {
  let meshCount = 0
  let vertexCount = 0
  let triangleCount = 0

  object.traverse((child) => {
    if (!('isMesh' in child) || !(child as Mesh).isMesh) return
    const mesh = child as Mesh
    if (!mesh.geometry) return

    meshCount += 1
    vertexCount += countVertices(mesh.geometry)
    triangleCount += countTriangles(mesh.geometry)
  })

  const box = new Box3().setFromObject(object)
  const dimensions: ModelDimensions = box.isEmpty()
    ? { width: 0, height: 0, depth: 0 }
    : {
        width: roundDimension(box.max.x - box.min.x),
        height: roundDimension(box.max.y - box.min.y),
        depth: roundDimension(box.max.z - box.min.z),
      }

  return { meshCount, vertexCount, triangleCount, dimensions }
}
