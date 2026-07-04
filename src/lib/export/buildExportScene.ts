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
import { extractBaseColor } from '../materials/extractBaseColor'
import { bakeCommittedPatternsIntoGeometry } from '../materials/patternMaterialApply'

const _v = new Vector3()

function resolveMaterial(material: Material | Material[]): Material {
  if (Array.isArray(material)) {
    return material.find(Boolean) ?? new MeshStandardMaterial()
  }
  return material ?? new MeshStandardMaterial()
}

function bakeWorldTransform(geometry: BufferGeometry, matrixWorld: Matrix4): void {
  const pos = geometry.getAttribute('position')
  if (!pos) return
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld)
    pos.setXYZ(i, _v.x, _v.y, _v.z)
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

/** Export scene with displaced geometry baked to world space. */
export function buildExportScene(root: Object3D): Group {
  root.updateMatrixWorld(true)
  const exportRoot = new Group()
  exportRoot.name = 'ExportRoot'

  root.traverse((object) => {
    if (object.userData?.isPreview || object.userData?.isHelper) return
    if (!('isMesh' in object) || !(object as Mesh).isMesh) return

    const source = object as Mesh
    if (!source.visible || !source.geometry) return

    const geometry = bakeCommittedPatternsIntoGeometry(source, root)
    bakeWorldTransform(geometry, source.matrixWorld)
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
  })

  if (exportRoot.children.length === 0) {
    throw new Error('No exportable geometry found.')
  }

  return exportRoot
}
