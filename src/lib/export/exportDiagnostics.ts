import { Box3, Vector3, type Object3D } from 'three'
import type { ExportQuality } from '../../types/bake'

export interface ExportDiagnostics {
  exportRoot: Object3D
  sourceTriangleCount: number
  appliedPatternCount: number
  exportUnitScale: number
  quality: ExportQuality
}

function countTrianglesInRoot(root: Object3D): number {
  let count = 0
  root.traverse((object) => {
    if (!('isMesh' in object) || !(object as { isMesh?: boolean }).isMesh) return
    const mesh = object as { geometry?: { index?: { count: number } | null; getAttribute: (n: string) => { count: number } } }
    if (!mesh.geometry) return
    const index = mesh.geometry.index
    count += index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3
  })
  return count
}

function countVerticesInRoot(root: Object3D): number {
  let count = 0
  root.traverse((object) => {
    if (!('isMesh' in object) || !(object as { isMesh?: boolean }).isMesh) return
    const mesh = object as { geometry?: { getAttribute: (n: string) => { count: number } } }
    if (!mesh.geometry) return
    count += mesh.geometry.getAttribute('position').count
  })
  return count
}

export function logExportGeometryStats(params: ExportDiagnostics): void {
  const bakedTriangleCount = countTrianglesInRoot(params.exportRoot)
  const vertexCount = countVerticesInRoot(params.exportRoot)

  const box = new Box3().setFromObject(params.exportRoot)
  const size = new Vector3()
  box.getSize(size)

  console.log('[3MF export] source triangles:', params.sourceTriangleCount)
  console.log('[3MF export] baked triangles:', bakedTriangleCount)
  console.log('[3MF export] baked vertices:', vertexCount)
  console.log('[3MF export] applied patterns:', params.appliedPatternCount)
  console.log('[3MF export] export unit scale:', params.exportUnitScale)
  console.log('[3MF export] quality:', params.quality)
  console.log('[3MF export] baked bbox size (mm):', {
    x: size.x.toFixed(3),
    y: size.y.toFixed(3),
    z: size.z.toFixed(3),
  })

  if (
    params.appliedPatternCount > 0 &&
    bakedTriangleCount <= params.sourceTriangleCount
  ) {
    console.warn(
      '[3MF export] Pattern exists but geometry was not subdivided/displaced.',
    )
  }
}
