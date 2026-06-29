import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three'

type PositionAttribute = BufferAttribute | InterleavedBufferAttribute

const VERTEX_PRECISION = 5

export function vertexPositionKey(position: PositionAttribute, index: number): string {
  return [
    position.getX(index).toFixed(VERTEX_PRECISION),
    position.getY(index).toFixed(VERTEX_PRECISION),
    position.getZ(index).toFixed(VERTEX_PRECISION),
  ].join(',')
}

export function edgePositionKey(
  position: PositionAttribute,
  ia: number,
  ib: number,
): string {
  const a = vertexPositionKey(position, ia)
  const b = vertexPositionKey(position, ib)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function getTriangleCount(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  if (index) return Math.floor(index.count / 3)
  return Math.floor(position.count / 3)
}
