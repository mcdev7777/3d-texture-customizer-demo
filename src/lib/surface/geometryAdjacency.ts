import type { BufferGeometry } from 'three'
import { getTriangleVertexIndices } from './computeFaceNormal'
import { edgePositionKey, getTriangleCount } from './geometryKeys'

export interface GeometryAdjacency {
  triangleCount: number
  neighbors: number[][]
}

const adjacencyCache = new WeakMap<BufferGeometry, GeometryAdjacency>()

export function getGeometryAdjacency(geometry: BufferGeometry): GeometryAdjacency {
  const cached = adjacencyCache.get(geometry)
  if (cached) return cached

  const position = geometry.getAttribute('position')
  const triangleCount = getTriangleCount(geometry)

  const edgeMap = new Map<string, number[]>()
  const neighbors: number[][] = Array.from({ length: triangleCount }, () => [])

  for (let face = 0; face < triangleCount; face++) {
    const [a, b, c] = getTriangleVertexIndices(geometry, face)
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ]

    for (const [v1, v2] of edges) {
      const key = edgePositionKey(position, v1, v2)
      const list = edgeMap.get(key)
      if (list) {
        list.push(face)
      } else {
        edgeMap.set(key, [face])
      }
    }
  }

  for (const faces of edgeMap.values()) {
    if (faces.length < 2) continue
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const fi = faces[i]
        const fj = faces[j]
        if (!neighbors[fi].includes(fj)) neighbors[fi].push(fj)
        if (!neighbors[fj].includes(fi)) neighbors[fj].push(fi)
      }
    }
  }

  const data: GeometryAdjacency = { triangleCount, neighbors }
  adjacencyCache.set(geometry, data)
  return data
}

export function clearAdjacencyCache(geometry: BufferGeometry): void {
  adjacencyCache.delete(geometry)
}
