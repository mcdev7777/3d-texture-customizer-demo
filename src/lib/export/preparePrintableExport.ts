import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import type { SurfacePatternPlacement } from '../../types/pattern'
import type { ExportQuality } from '../../types/bake'
import { extractBaseColor } from '../materials/extractBaseColor'
import { bakePatternsForExport } from '../materials/patternMaterialApply'
import {
  getExportOutputTriangles,
} from '../geometry/subdivideSelection'
import { logExportGeometryStats } from './exportDiagnostics'
import {
  type ExportProgressCallback,
  yieldIfBusy,
  yieldToMain,
} from './exportProgress'

const _v = new Vector3()

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

async function bakeWorldTransform(geometry: BufferGeometry, matrixWorld: Matrix4): Promise<void> {
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const chunk = 12_000
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
    pos.setXYZ(i, _v.x, _v.y, _v.z)
    if (i > 0 && i % chunk === 0) await yieldIfBusy()
  }
  pos.needsUpdate = true
}

async function applyExportUnitScale(geometry: BufferGeometry, scale: number): Promise<void> {
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-9) return
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const chunk = 12_000
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale)
    if (i > 0 && i % chunk === 0) await yieldIfBusy()
  }
  pos.needsUpdate = true
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
    if (object.userData?.isPreview || object.userData?.isHelper) return
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return
    const index = mesh.geometry.index
    count += index ? index.count / 3 : mesh.geometry.getAttribute('position').count / 3
  })
  return count
}

function collectExportMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse((object) => {
    if (object.userData?.isPreview || object.userData?.isHelper) return
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return
    const mesh = object as Mesh
    if (!mesh.visible || !mesh.geometry) return
    meshes.push(mesh)
  })
  return meshes
}

function meshHasCommittedPatterns(
  mesh: Mesh,
  committedSurfaceIds: readonly string[],
): boolean {
  return committedSurfaceIds.some((surfaceId) => surfaceId.startsWith(`${mesh.uuid}:`))
}

/**
 * Clone the scene, bake all committed pattern regions into geometry, decimate to
 * the quality target, restore millimeter dimensions, and return a temporary export
 * root. Does not modify the live scene.
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

  for (let meshIndex = 0; meshIndex < exportMeshes.length; meshIndex++) {
    const source = exportMeshes[meshIndex]!
    const meshFraction = meshIndex / exportMeshes.length
    const nextMeshFraction = (meshIndex + 1) / exportMeshes.length
    const bakeStart = 0.05 + meshFraction * 0.82
    const bakeEnd = 0.05 + nextMeshFraction * 0.82
    const hasPatterns = meshHasCommittedPatterns(source, committedSurfaceIds)

    onProgress?.(
      bakeStart,
      exportMeshes.length > 1
        ? `Processing mesh ${meshIndex + 1}/${exportMeshes.length}…`
        : hasPatterns
          ? 'Baking relief geometry…'
          : 'Copying mesh…',
    )
    await yieldToMain()

    let geometry = await bakePatternsForExport(
      source,
      root,
      placements,
      committedSurfaceIds,
      quality,
      exportUnitScale,
      hasPatterns
        ? (fraction, label) => {
            onProgress?.(bakeStart + (bakeEnd - bakeStart) * fraction, label)
          }
        : undefined,
    )

    await bakeWorldTransform(geometry, source.matrixWorld)
    await applyExportUnitScale(geometry, exportUnitScale)
    geometry.computeVertexNormals()

    const material = resolveMaterial(source.material)
    ensureVertexColors(geometry, material)

    const exportMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: material instanceof MeshStandardMaterial ? material.roughness : 0.55,
      metalness: material instanceof MeshStandardMaterial ? material.metalness : 0.15,
    })

    const exportMesh = new Mesh(geometry, exportMat)
    exportMesh.name = source.name || 'Mesh'
    exportRoot.add(exportMesh)
  }

  onProgress?.(0.92, 'Finalizing export…')
  await yieldToMain()

  if (import.meta.env.DEV) {
    console.log(
      '[3MF export] quality target triangles:',
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
