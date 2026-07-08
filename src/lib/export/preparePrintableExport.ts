import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three'
import type { SurfacePatternPlacement } from '../../types/pattern'
import type { ExportQuality } from '../../types/bake'
import { extractBaseColor } from '../materials/extractBaseColor'
import { getExportOutputTriangles } from '../geometry/subdivideSelection'
import { bakeMeshRegions } from '../mesh-engine/adapters/bakeMeshRegions'
import { collectExportMeshes, isExportExcluded } from '../mesh-engine/adapters/collectMeshPositions'
import { mapPipelineProgress } from '../mesh-engine/adapters/runMeshPipeline'
import { logExportGeometryStats } from './exportDiagnostics'
import { type ExportProgressCallback, yieldToMain } from './exportProgress'

export interface PrintableExportOptions {
  placements: Record<string, SurfacePatternPlacement>
  committedSurfaceIds: readonly string[]
  quality: ExportQuality
  exportUnitScale: number
  onProgress?: ExportProgressCallback
}

function resolveMaterial(material: Material | Material[]): Material {
  if (Array.isArray(material)) {
    return material.find(Boolean) ?? new MeshStandardMaterial()
  }
  return material ?? new MeshStandardMaterial()
}

function ensureVertexColors(geometry: BufferGeometry, material: Material): void {
  if (geometry.getAttribute('color')) return
  const base = extractBaseColor(material)
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = base.r
    colors[i * 3 + 1] = base.g
    colors[i * 3 + 2] = base.b
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
}

function countSourceTriangles(root: Object3D): number {
  let count = 0
  root.traverse((object) => {
    if (isExportExcluded(object)) return
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return
    const index = mesh.geometry.index
    count += index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3
  })
  return count
}

/**
 * Clone the scene, bake all committed pattern regions into geometry via the
 * same fast worker-backed mesh-engine pipeline 3MF export uses (subdivide →
 * displace per-region → decimate), restore millimeter dimensions, and return
 * a temporary export root. Does not modify the live scene.
 *
 * Previously routed through a separate, main-thread-only, per-region TS bake
 * path (bakeReliefIntoGeometry/subdivideForReliefPattern) with no worker and
 * none of the mesh-engine's adaptive-resolution/triangle-budget tuning —
 * several times slower for the same detail level. STL/OBJ/GLB now share the
 * exact pipeline call 3MF uses; only the final packaging step differs.
 */
export async function preparePrintableExport(
  root: Object3D,
  options: PrintableExportOptions,
): Promise<Group> {
  const { placements, committedSurfaceIds, quality, exportUnitScale, onProgress } = options
  const appliedPatternCount = committedSurfaceIds.length
  const sourceTriangleCount = countSourceTriangles(root)

  root.updateMatrixWorld(true)

  const exportMeshes = collectExportMeshes(root)
  if (exportMeshes.length === 0) {
    throw new Error('No exportable geometry found.')
  }

  onProgress?.(0.04, 'Preparing export…')
  await yieldToMain()

  const exportRoot = new Group()
  exportRoot.name = 'ExportRoot'

  let exportToken = 0
  const myToken = ++exportToken
  const isStale = () => exportToken !== myToken

  for (let meshIndex = 0; meshIndex < exportMeshes.length; meshIndex++) {
    const mesh = exportMeshes[meshIndex]!
    const meshFraction = meshIndex / exportMeshes.length
    const nextMeshFraction = (meshIndex + 1) / exportMeshes.length
    const bakeStart = 0.05 + meshFraction * 0.82
    const bakeEnd = 0.05 + nextMeshFraction * 0.82

    onProgress?.(
      bakeStart,
      exportMeshes.length > 1 ? `Processing mesh ${meshIndex + 1}/${exportMeshes.length}…` : 'Baking relief geometry…',
    )
    await yieldToMain()

    const result = await bakeMeshRegions(
      mesh,
      root,
      placements,
      committedSurfaceIds,
      quality,
      exportUnitScale,
      exportUnitScale,
      mapPipelineProgress(
        (fraction, label) => onProgress?.(bakeStart + (bakeEnd - bakeStart) * fraction, label),
        0,
        1,
      ),
      isStale,
    )

    if (!result || isStale()) {
      throw new Error('Export was cancelled.')
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(result.positions, 3))
    if (result.normals) {
      geometry.setAttribute('normal', new BufferAttribute(result.normals, 3))
    } else {
      geometry.computeVertexNormals()
    }

    const material = resolveMaterial(mesh.material)
    ensureVertexColors(geometry, material)

    const exportMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: material instanceof MeshStandardMaterial ? material.roughness : 0.55,
      metalness: material instanceof MeshStandardMaterial ? material.metalness : 0.15,
    })

    const exportMesh = new Mesh(geometry, exportMat)
    exportMesh.name = mesh.name || 'Mesh'
    exportRoot.add(exportMesh)
  }

  onProgress?.(0.92, 'Finalizing export…')
  await yieldToMain()

  if (import.meta.env.DEV) {
    console.log(
      '[printable export] quality target triangles:',
      getExportOutputTriangles(quality).toLocaleString(),
    )
  }

  logExportGeometryStats({
    exportRoot,
    sourceTriangleCount,
    appliedPatternCount,
    exportUnitScale,
    quality,
  })

  return exportRoot
}
