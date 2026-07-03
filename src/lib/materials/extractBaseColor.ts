import { Color, type Material, MeshStandardMaterial, MeshPhongMaterial, MeshBasicMaterial, MeshPhysicalMaterial, MeshLambertMaterial } from 'three'

/** Read the diffuse/base color from a mesh material, with a viewer fallback. */
export function extractBaseColor(material: Material): Color {
  if (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshLambertMaterial ||
    material instanceof MeshBasicMaterial
  ) {
    return material.color.clone()
  }
  return new Color(0xc4b5fd)
}

/**
 * Derive the emphasized (pattern-black) tint from the surface base color.
 * Fixed offset — depth is expressed through bump shading, not color darkening.
 */
export function computeEmphasisColor(base: Color): Color {
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  return new Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.08), Math.max(0, hsl.l - 0.28))
}
