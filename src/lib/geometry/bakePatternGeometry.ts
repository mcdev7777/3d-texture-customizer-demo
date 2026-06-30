import {
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three'
import type {
  GeometryBakeOptions,
  GeometryBakeResult,
  PatternPlacement,
} from '../../types/bake'
import { getPatternCanvas } from '../../utils/patternTextures'
import { createPatternTextureForPlacement } from '../textures/createPatternTextureForPlacement'
import { samplePatternHeight } from '../textures/patternPlacementMath'
import { markIgnoreRaycast } from '../three/raycastUtils'
import { disposeObject } from '../three/disposeObject'
import { settingsFromPlacement } from '../../types/bake'

const DEFAULT_SEGMENT_COUNT = 64
const MAX_SEGMENT_COUNT = 128
const MIN_SEGMENT_COUNT = 16
const DEFAULT_MAX_DEPTH = 0.15
const MIN_PANEL_SIZE = 0.05

const _position = new Vector3()
const _quaternion = new Quaternion()

export interface SurfaceBasis {
  origin: Vector3
  uAxis: Vector3
  vAxis: Vector3
  normal: Vector3
}

export function computeSurfaceBasis(placement: PatternPlacement): SurfaceBasis {
  const normal = new Vector3(...placement.plane.normal).normalize()
  const origin = new Vector3(...placement.plane.center)

  let uAxis = new Vector3(0, 1, 0)
  if (Math.abs(normal.dot(uAxis)) > 0.92) {
    uAxis = new Vector3(1, 0, 0)
  }
  uAxis = uAxis.cross(normal).normalize()
  const vAxis = new Vector3().crossVectors(normal, uAxis).normalize()

  return { origin, uAxis, vAxis, normal }
}

export function projectPointToSurfaceUV(
  point: Vector3,
  basis: SurfaceBasis,
  width: number,
  height: number,
): [number, number] {
  const local = point.clone().sub(basis.origin)
  const u = local.dot(basis.uAxis) / width + 0.5
  const v = local.dot(basis.vAxis) / height + 0.5
  return [u, v]
}

function clampSegmentCount(count?: number): number {
  const value = count ?? DEFAULT_SEGMENT_COUNT
  return Math.min(MAX_SEGMENT_COUNT, Math.max(MIN_SEGMENT_COUNT, Math.floor(value)))
}

function clampDepth(depth: number, maxDepth: number): number {
  return Math.min(Math.max(depth, 0), maxDepth)
}

export function generateDisplacedPanelGeometry(
  placement: PatternPlacement,
  options: { segmentCount: number; maxDepth: number },
): { geometry: BufferGeometry; warnings: string[] } {
  const warnings: string[] = []
  const { plane } = placement
  const settings = settingsFromPlacement(placement)
  const segments = clampSegmentCount(options.segmentCount)

  if (plane.width < MIN_PANEL_SIZE || plane.height < MIN_PANEL_SIZE) {
    warnings.push(`Surface ${placement.label} is very small; using minimum panel size.`)
  }

  const width = Math.max(plane.width, MIN_PANEL_SIZE)
  const height = Math.max(plane.height, MIN_PANEL_SIZE)
  const geometry = new PlaneGeometry(width, height, segments, segments)
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')

  const canvas = getPatternCanvas(placement.patternId, 512)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    warnings.push(`Canvas unavailable for "${placement.label}"; using flat displacement.`)
  }
  const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null

  const depth = clampDepth(placement.depth, options.maxDepth)
  const sign = placement.mode === 'emboss' ? 1 : -1

  for (let i = 0; i < position.count; i++) {
    const panelU = uv.getX(i)
    const panelV = uv.getY(i)
    const heightSample = imageData
      ? samplePatternHeight(imageData, panelU, panelV, settings)
      : 0
    const displacement = sign * heightSample * depth
    position.setZ(i, displacement)
  }

  geometry.computeVertexNormals()
  return { geometry, warnings }
}

function createBakedPatchMesh(
  placement: PatternPlacement,
  options: { segmentCount: number; maxDepth: number; includeTextures: boolean },
): { mesh: Mesh; warnings: string[] } {
  const { geometry, warnings } = generateDisplacedPanelGeometry(placement, options)
  const settings = settingsFromPlacement(placement)

  let material: MeshStandardMaterial
  if (options.includeTextures) {
    const texture = createPatternTextureForPlacement(placement.patternId, settings)
    if (texture) {
      material = new MeshStandardMaterial({
        map: texture,
        roughness: placement.mode === 'emboss' ? 0.35 : 0.75,
        metalness: placement.mode === 'emboss' ? 0.15 : 0.05,
        transparent: placement.opacity < 1,
        opacity: placement.opacity,
      })
    } else {
      warnings.push(`Could not create texture for "${placement.label}"; using solid material.`)
      material = new MeshStandardMaterial({
        color: placement.mode === 'emboss' ? '#e9e5ff' : '#312e81',
        roughness: 0.5,
        metalness: 0.1,
      })
    }
  } else {
    material = new MeshStandardMaterial({
      color: placement.mode === 'emboss' ? '#e9e5ff' : '#312e81',
      roughness: 0.5,
      metalness: 0.1,
    })
  }

  const mesh = new Mesh(geometry, material)
  mesh.name = `BakedPatch:${placement.surfaceId}`

  _position.set(...placement.plane.center)
  _quaternion.set(...placement.plane.quaternion)
  mesh.position.copy(_position)
  mesh.quaternion.copy(_quaternion)

  const lift = placement.mode === 'emboss' ? 0.001 : -0.001
  mesh.position.addScaledVector(new Vector3(...placement.plane.normal), lift)

  mesh.userData.isBakedPatch = true
  mesh.userData.exportable = true
  mesh.userData.surfaceId = placement.surfaceId
  markIgnoreRaycast(mesh)

  return { mesh, warnings }
}

function cloneModelForExport(originalModel: Object3D): Object3D {
  const clone = originalModel.clone(true)
  clone.traverse((child) => {
    if ('isMesh' in child && child.isMesh) {
      const mesh = child as Mesh
      if (mesh.geometry) {
        mesh.geometry = mesh.geometry.clone()
      }
      mesh.userData.exportable = true
    }
  })
  return clone
}

export function buildExportableModifiedObject(
  originalModel: Object3D,
  bakedPatches: Mesh[],
): Object3D {
  const group = new Group()
  group.name = 'BakedExportRoot'
  group.userData.exportable = true

  const modelClone = cloneModelForExport(originalModel)
  group.add(modelClone)

  for (const patch of bakedPatches) {
    patch.userData.isBakedPatch = true
    patch.userData.exportable = true
    markIgnoreRaycast(patch)
    group.add(patch)
  }

  return group
}

export function disposeBakedObject(object: Object3D | null): void {
  if (!object) return
  disposeObject(object)
}

export async function bakePatternGeometry(
  originalModel: Object3D,
  options: GeometryBakeOptions,
): Promise<GeometryBakeResult> {
  const warnings: string[] = []
  const segmentCount = clampSegmentCount(options.segmentCount)
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const includeTextures = options.includeTextures ?? true

  const activePlacements = options.placements.filter((p) => p.patternId)
  if (activePlacements.length === 0) {
    throw new Error('No pattern placements to bake.')
  }

  const bakedMeshes: Mesh[] = []

  for (const placement of activePlacements) {
    if (placement.plane.width * placement.plane.height > 4) {
      warnings.push(
        `Surface "${placement.label}" is large; using ${segmentCount}×${segmentCount} tessellation.`,
      )
    }

    const { mesh, warnings: patchWarnings } = createBakedPatchMesh(placement, {
      segmentCount,
      maxDepth,
      includeTextures,
    })
    bakedMeshes.push(mesh)
    warnings.push(...patchWarnings)
  }

  const object = buildExportableModifiedObject(originalModel, bakedMeshes)

  return { object, bakedMeshes, warnings }
}

export function collectPlacementsFromStore(
  placements: Record<
    string,
    {
      surfaceId: string
      label: string
      settings: import('../../types/pattern').SurfacePatternSettings
      plane: PatternPlacement['plane']
    }
  >,
): PatternPlacement[] {
  const result: PatternPlacement[] = []
  for (const entry of Object.values(placements)) {
    if (!entry.settings.patternId) continue
    result.push({
      surfaceId: entry.surfaceId,
      label: entry.label,
      patternId: entry.settings.patternId,
      offsetX: entry.settings.offsetX,
      offsetY: entry.settings.offsetY,
      scale: entry.settings.scale,
      rotation: entry.settings.rotation,
      depth: entry.settings.depth,
      mode: entry.settings.mode,
      opacity: entry.settings.opacity,
      plane: entry.plane,
    })
  }
  return result
}
