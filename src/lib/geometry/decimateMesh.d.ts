import type { BufferGeometry } from 'three'

export function decimate(
  geometry: BufferGeometry,
  targetTriangles: number,
  onProgress?: (fraction: number) => void,
): Promise<BufferGeometry>
