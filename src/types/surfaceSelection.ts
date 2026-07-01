import type { BufferGeometry, Mesh, Vector3 } from 'three'

export type SelectionMode = 'surface' | 'part'

export interface SurfacePick {
  mesh: Mesh
  faceIndex: number
  point: Vector3
  normal: Vector3
}

export interface SelectedSurface {
  surfaceId: string
  meshUuid: string
  meshName: string
  faceIndex: number
  selectionType: SelectionMode
  point: Vector3
  normal: Vector3
  triangleIndices: number[]
  triangleCount: number
  area: number
  highlightGeometry: BufferGeometry
}

export interface SurfaceSelectionSettings {
  enabled: boolean
  angleTolerance: number
}

export const DEFAULT_ANGLE_TOLERANCE = 35
export const MIN_ANGLE_TOLERANCE = 5
export const MAX_ANGLE_TOLERANCE = 80
export const MAX_SELECTION_TRIANGLES = 50_000
