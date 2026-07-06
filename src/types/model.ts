import type { Object3D } from 'three'

export type SupportedFileType = 'stl' | 'obj' | 'glb' | 'gltf' | '3mf'

export const SUPPORTED_EXTENSIONS: readonly SupportedFileType[] = [
  'stl',
  'obj',
  'glb',
  'gltf',
  '3mf',
] as const

export const ACCEPTED_FILE_EXTENSIONS = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export interface ModelDimensions {
  width: number
  height: number
  depth: number
}

export interface ModelStats {
  meshCount: number
  vertexCount: number
  triangleCount: number
  dimensions: ModelDimensions
}

export interface LoadedModel {
  object: Object3D
  stats: ModelStats
  objectUrl: string | null
  /** Multiply viewer-space coordinates to restore source millimeter dimensions. */
  exportUnitScale: number
}

export interface ViewerSettings {
  showGrid: boolean
  showAxes: boolean
  showWireframe: boolean
  showBoundingBox: boolean
}

export interface CameraActions {
  reset: () => void
  fit: () => void
}
