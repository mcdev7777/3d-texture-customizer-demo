import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three'

export interface OptimizeExportGeometryResult {
  geometry: BufferGeometry
  verticesBefore: number
  verticesAfter: number
  trianglesBefore: number
  trianglesAfter: number
}

function packVertexKey(x: number, y: number, z: number, quant: number): bigint {
  const ix = (Math.round(x * quant) + 0x100000) >>> 0
  const iy = (Math.round(y * quant) + 0x100000) >>> 0
  const iz = (Math.round(z * quant) + 0x100000) >>> 0
  return (BigInt(ix & 0x1fffff) << 42n) | (BigInt(iy & 0x1fffff) << 21n) | BigInt(iz & 0x1fffff)
}

/**
 * Weld coincident vertices and drop degenerate triangles before 3MF serialization.
 * Coordinates are expected in millimeters.
 */
export function optimizeBufferGeometryForExport(
  geometry: BufferGeometry,
  weldToleranceMm = 0.008,
): OptimizeExportGeometryResult {
  const pos = geometry.getAttribute('position') as BufferAttribute | undefined
  const index = geometry.index
  if (!pos || !index) {
    const count = pos?.count ?? 0
    return {
      geometry,
      verticesBefore: count,
      verticesAfter: count,
      trianglesBefore: count / 3,
      trianglesAfter: count / 3,
    }
  }

  const trianglesBefore = index.count / 3
  const verticesBefore = pos.count
  const quant = 1 / Math.max(weldToleranceMm, 1e-6)

  const newPositions: number[] = []
  const remap = new Map<bigint, number>()
  const newIndices: number[] = []

  const getVertex = (vi: number): number => {
    const x = pos.getX(vi)
    const y = pos.getY(vi)
    const z = pos.getZ(vi)
    const key = packVertexKey(x, y, z, quant)
    let next = remap.get(key)
    if (next === undefined) {
      next = newPositions.length / 3
      newPositions.push(x, y, z)
      remap.set(key, next)
    }
    return next
  }

  for (let t = 0; t < trianglesBefore; t++) {
    const ia = getVertex(index.getX(t * 3))
    const ib = getVertex(index.getX(t * 3 + 1))
    const ic = getVertex(index.getX(t * 3 + 2))
    if (ia === ib || ib === ic || ic === ia) continue
    newIndices.push(ia, ib, ic)
  }

  const optimized = new BufferGeometry()
  optimized.setAttribute('position', new Float32BufferAttribute(newPositions, 3))
  optimized.setIndex(newIndices)

  const color = geometry.getAttribute('color')
  if (color) {
    optimized.setAttribute('color', color.clone())
  }

  optimized.computeBoundingBox()
  optimized.computeBoundingSphere()
  geometry.dispose()

  return {
    geometry: optimized,
    verticesBefore,
    verticesAfter: newPositions.length / 3,
    trianglesBefore,
    trianglesAfter: newIndices.length / 3,
  }
}
