import {
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import type { PatternPlacement } from '../../types/bake'
import type { PatternId, PatternMode, SurfacePlaneData } from '../../types/pattern'
import { getPatternCanvas } from '../../utils/patternTextures'
import {
  depthLevelToWorld,
  getDisplacementAmount,
  samplePatternHeight,
} from '../textures/patternPlacementMath'
import { markIgnoreRaycast } from '../three/raycastUtils'
import { settingsFromPlacement } from '../../types/bake'

const DEFAULT_SEGMENT_COUNT = 72
const MAX_SEGMENT_COUNT = 160
const MIN_SEGMENT_COUNT = 16
const MIN_PANEL_SIZE = 0.05

/** Fallback tint used only when the source surface exposes no readable base color. */
const FALLBACK_SURFACE_COLOR = '#c9b8f0'

export type PatchRole = 'preview' | 'committed'

const _position = new Vector3()
const _quaternion = new Quaternion()

interface PlaneSampleSettings {
  patternId: PatternId
  mode: PatternMode
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  depth: number
}

function clampSegmentCount(count?: number): number {
  const value = count ?? DEFAULT_SEGMENT_COUNT
  return Math.min(MAX_SEGMENT_COUNT, Math.max(MIN_SEGMENT_COUNT, Math.floor(value)))
}

function getPatternImageData(patternId: PatternId): ImageData | null {
  const canvas = getPatternCanvas(patternId, 512)
  const ctx = canvas.getContext('2d')
  return ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null
}

/**
 * Build a displaced plane for one planar island. The pattern image data is
 * sampled purely as a height mask (never as color); emboss raises the mask,
 * engrave carves it back from a thin raised slab so it reads as recessed.
 */
export function generateDisplacedPanelGeometry(
  plane: SurfacePlaneData,
  settings: PlaneSampleSettings,
  segmentCount: number,
  imageData: ImageData | null,
): { geometry: BufferGeometry; warnings: string[] } {
  const warnings: string[] = []
  const segments = clampSegmentCount(segmentCount)

  if (plane.width < MIN_PANEL_SIZE || plane.height < MIN_PANEL_SIZE) {
    warnings.push('A selected region is very small; using minimum panel size.')
  }

  const width = Math.max(plane.width, MIN_PANEL_SIZE)
  const height = Math.max(plane.height, MIN_PANEL_SIZE)
  const geometry = new PlaneGeometry(width, height, segments, segments)
  const positionAttr = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')

  const depthWorld = depthLevelToWorld(settings.depth)

  for (let i = 0; i < positionAttr.count; i++) {
    const panelU = uv.getX(i)
    const panelV = uv.getY(i)
    const maskValue = imageData ? samplePatternHeight(imageData, panelU, panelV, settings) : 0
    positionAttr.setZ(i, getDisplacementAmount(maskValue, settings.mode, depthWorld))
  }

  // Recompute normals so raised/recessed edges catch the light.
  geometry.computeVertexNormals()
  return { geometry, warnings }
}

function resolveSourceMaterial(
  source?: Material | Material[] | null,
): MeshStandardMaterial | undefined {
  const mat = Array.isArray(source) ? source[0] : source
  return (mat as MeshStandardMaterial | undefined) ?? undefined
}

function deriveSurfaceColor(source?: Material | Material[] | null): Color {
  const mat = resolveSourceMaterial(source)
  const color = mat && 'color' in mat ? (mat.color as Color | undefined) : undefined
  if (color && (color as Color).isColor) {
    return color.clone()
  }
  return new Color(FALLBACK_SURFACE_COLOR)
}

/**
 * Material for applied/preview relief geometry.
 *
 * The pattern is expressed entirely through vertex displacement, so this material
 * only carries the selected surface's base color/roughness/metalness. The pattern
 * canvas is never assigned as a diffuse map — the surface keeps its original color.
 */
export function createAppliedTextureMaterial(
  source: Material | Material[] | null | undefined,
  role: PatchRole,
): MeshStandardMaterial {
  const src = resolveSourceMaterial(source)
  const material = new MeshStandardMaterial({
    color: deriveSurfaceColor(source),
    roughness: src && typeof src.roughness === 'number' ? src.roughness : 0.5,
    metalness: src && typeof src.metalness === 'number' ? src.metalness : 0.05,
  })

  // Sit just above the base surface without z-fighting.
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1

  if (role === 'preview') {
    // Faint tint so an uncommitted preview reads as "active" while keeping the
    // surface color visible. Never an opaque black/white overlay.
    material.emissive = new Color('#7c3aed')
    material.emissiveIntensity = 0.22
  }

  return material
}

export interface CreatePatchOptions {
  segmentCount: number
  role: PatchRole
  sourceMaterial?: Material | Material[] | null
}

/** Build one displaced patch mesh positioned on a single planar island. */
function createPatchMeshForPlane(
  plane: SurfacePlaneData,
  settings: PlaneSampleSettings,
  material: MeshStandardMaterial,
  segmentCount: number,
  role: PatchRole,
  imageData: ImageData | null,
): { mesh: Mesh; warnings: string[] } {
  const { geometry, warnings } = generateDisplacedPanelGeometry(
    plane,
    settings,
    segmentCount,
    imageData,
  )

  const mesh = new Mesh(geometry, material)
  mesh.name = role === 'preview' ? 'PreviewPatch' : 'CommittedPatch'

  _position.set(...plane.center)
  _quaternion.set(...plane.quaternion)
  mesh.position.copy(_position)
  mesh.quaternion.copy(_quaternion)

  // Lift a hair outward so the flat background never z-fights the base surface.
  mesh.position.addScaledVector(new Vector3(...plane.normal), 0.001)

  mesh.userData.isPreview = role === 'preview'
  mesh.userData.isCommittedPatch = role === 'committed'
  mesh.userData.exportable = role === 'committed'
  markIgnoreRaycast(mesh)

  return { mesh, warnings }
}

/**
 * Build a group of relief patches for a placement — one patch per planar island.
 * The group is tagged with the surface id so it can be committed/removed/toggled
 * as a unit. Preview and Apply share this builder for identical results.
 */
export function createPatchGroup(
  placement: PatternPlacement,
  options: CreatePatchOptions,
): { group: Group; warnings: string[] } {
  const settings: PlaneSampleSettings = {
    ...settingsFromPlacement(placement),
    patternId: placement.patternId,
  }
  const material = createAppliedTextureMaterial(options.sourceMaterial, options.role)
  const imageData = getPatternImageData(placement.patternId)

  const group = new Group()
  group.name = options.role === 'preview' ? 'PreviewPatchGroup' : 'CommittedPatchGroup'
  group.userData.surfaceId = placement.surfaceId
  group.userData.isPreview = options.role === 'preview'
  group.userData.isCommittedPatch = options.role === 'committed'
  group.userData.exportable = options.role === 'committed'

  const warnings: string[] = []
  if (!imageData) warnings.push('Pattern canvas unavailable; using flat displacement.')
  for (const plane of placement.planes) {
    const { mesh, warnings: patchWarnings } = createPatchMeshForPlane(
      plane,
      settings,
      material,
      options.segmentCount,
      options.role,
      imageData,
    )
    group.add(mesh)
    warnings.push(...patchWarnings)
  }

  return { group, warnings: [...new Set(warnings)] }
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

/**
 * Assemble an exportable object from the original model plus committed patches.
 *
 * The committed group is deep-cloned (geometry per mesh) so live scene copies are
 * never reparented or mutated. Callers should dispose the returned object's cloned
 * geometries after export.
 */
export function buildExportableModifiedObject(
  originalModel: Object3D,
  committedRoot: Object3D,
): Object3D {
  const group = new Group()
  group.name = 'ModifiedExportRoot'
  group.userData.exportable = true

  group.add(cloneModelForExport(originalModel))

  const committedClone = committedRoot.clone(true)
  committedClone.traverse((child) => {
    if ('isMesh' in child && child.isMesh) {
      const mesh = child as Mesh
      if (mesh.geometry) mesh.geometry = mesh.geometry.clone()
      mesh.userData.exportable = true
      markIgnoreRaycast(mesh)
    }
  })
  group.add(committedClone)

  return group
}
