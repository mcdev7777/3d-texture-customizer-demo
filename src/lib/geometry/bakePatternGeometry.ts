import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three'
import { markIgnoreRaycast } from '../three/raycastUtils'

/** Fallback tint used only when the source surface exposes no readable base color. */
const FALLBACK_SURFACE_COLOR = '#c9b8f0'

export type PatchRole = 'preview' | 'committed'

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
