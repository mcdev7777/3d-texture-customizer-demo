import {
  BufferGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { normalizeModel } from './normalizeModel'
import { disposeObject } from '../three/disposeObject'
import type { LoadedModel, SupportedFileType } from '../../types/model'
import { SUPPORTED_EXTENSIONS } from '../../types/model'

const VIEWER_MATERIAL = new MeshStandardMaterial({
  color: 0xc4b5fd,
  metalness: 0.15,
  roughness: 0.55,
})

export function getFileExtension(fileName: string): string {
  const trimmed = fileName.trim()
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return ''
  return trimmed.slice(dotIndex + 1).toLowerCase()
}

export function parseFileType(fileName: string): SupportedFileType | null {
  const ext = getFileExtension(fileName)
  if (SUPPORTED_EXTENSIONS.includes(ext as SupportedFileType)) {
    return ext as SupportedFileType
  }
  return null
}

export function formatFileTypeLabel(fileType: SupportedFileType | null): string {
  if (!fileType) return '—'
  if (fileType === '3mf') return '3MF'
  return fileType.toUpperCase()
}

function isViewerCompatibleMaterial(mat: Material): boolean {
  return (
    mat instanceof MeshStandardMaterial ||
    mat instanceof MeshPhysicalMaterial ||
    mat instanceof MeshPhongMaterial ||
    mat instanceof MeshLambertMaterial ||
    mat instanceof MeshBasicMaterial
  )
}

function ensureViewerMaterials(object: Object3D, preserveExisting: boolean): void {
  object.traverse((child) => {
    if (!('isMesh' in child) || !(child as Mesh).isMesh) return
    const mesh = child as Mesh

    if (preserveExisting && mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.every((mat) => mat && isViewerCompatibleMaterial(mat))) return
    }

    if (!mesh.material) {
      mesh.material = VIEWER_MATERIAL.clone()
      return
    }

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((mat) =>
        mat && isViewerCompatibleMaterial(mat) ? mat : VIEWER_MATERIAL.clone(),
      )
    } else if (!isViewerCompatibleMaterial(mesh.material)) {
      mesh.material = VIEWER_MATERIAL.clone()
    }
  })
}

async function loadStl(url: string): Promise<Object3D> {
  const loader = new STLLoader()
  const geometry: BufferGeometry = await loader.loadAsync(url)
  geometry.computeVertexNormals()
  return new Mesh(geometry, VIEWER_MATERIAL.clone())
}

async function loadObj(url: string): Promise<Object3D> {
  const loader = new OBJLoader()
  const object = await loader.loadAsync(url)
  ensureViewerMaterials(object, false)
  return object
}

async function loadGltf(url: string): Promise<Object3D> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  ensureViewerMaterials(gltf.scene, true)
  return gltf.scene
}

async function load3mf(arrayBuffer: ArrayBuffer): Promise<Object3D> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })

  const loader = new ThreeMFLoader()
  const object = loader.parse(arrayBuffer)
  ensureViewerMaterials(object, true)
  return object
}

function hasVisibleGeometry(object: Object3D): boolean {
  let found = false
  object.traverse((child) => {
    if ('isMesh' in child && (child as Mesh).isMesh) found = true
  })
  return found
}

export async function loadModelFromFile(file: File): Promise<LoadedModel> {
  const fileType = parseFileType(file.name)
  if (!fileType) {
    throw new Error(
      `Unsupported file type. Supported formats: ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`,
    )
  }

  const objectUrl = URL.createObjectURL(file)
  const arrayBuffer = fileType === '3mf' ? await file.arrayBuffer() : null

  try {
    let rawObject: Object3D

    switch (fileType) {
      case 'stl':
        rawObject = await loadStl(objectUrl)
        break
      case 'obj':
        rawObject = await loadObj(objectUrl)
        break
      case 'glb':
      case 'gltf':
        rawObject = await loadGltf(objectUrl)
        break
      case '3mf':
        rawObject = await load3mf(arrayBuffer!)
        break
      default: {
        const _exhaustive: never = fileType
        throw new Error(`Unsupported file type: .${_exhaustive}`)
      }
    }

    if (!rawObject || !hasVisibleGeometry(rawObject)) {
      disposeObject(rawObject)
      throw new Error('Failed to parse model — file may be corrupt or contain no geometry.')
    }

    const { object, stats } = normalizeModel(rawObject)

    return {
      object,
      stats,
      objectUrl,
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    if (err instanceof Error && err.message.startsWith('Unsupported')) throw err
    if (err instanceof Error && err.message.startsWith('Failed to parse')) throw err
    throw new Error(
      err instanceof Error ? `Could not load model: ${err.message}` : 'Could not load model.',
    )
  }
}

export function revokeModelUrl(model: LoadedModel | null): void {
  if (model?.objectUrl) {
    URL.revokeObjectURL(model.objectUrl)
  }
}

export function unloadCurrentModel(current: LoadedModel | null): void {
  if (!current) return
  disposeObject(current.object)
  revokeModelUrl(current)
}
