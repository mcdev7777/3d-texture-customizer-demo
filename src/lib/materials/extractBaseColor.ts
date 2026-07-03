import {
  BufferGeometry,
  Color,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  type Texture,
} from 'three'

const VIEWER_FALLBACK = 0xc4b5fd

type ColorMaterial =
  | MeshStandardMaterial
  | MeshPhysicalMaterial
  | MeshPhongMaterial
  | MeshLambertMaterial
  | MeshBasicMaterial

function isColorMaterial(material: Material): material is ColorMaterial {
  return (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshLambertMaterial ||
    material instanceof MeshBasicMaterial
  )
}

/** Read the diffuse/base color from a mesh material, with a viewer fallback. */
export function extractBaseColor(material: Material): Color {
  if (isColorMaterial(material)) {
    return material.color.clone()
  }
  return new Color(VIEWER_FALLBACK)
}

function sampleTextureAverage(map: Texture): Color | null {
  const image = map.image as CanvasImageSource | undefined
  if (!image || !('width' in image) || !image.width || !('height' in image) || !image.height) {
    return null
  }

  const sampleSize = 8
  const canvas = document.createElement('canvas')
  canvas.width = sampleSize
  canvas.height = sampleSize
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  try {
    ctx.drawImage(image, 0, 0, sampleSize, sampleSize)
  } catch {
    return null
  }

  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    if (alpha < 0.05) continue
    r += data[i] * alpha
    g += data[i + 1] * alpha
    b += data[i + 2] * alpha
    count += alpha
  }
  if (count <= 0) return null
  return new Color(r / count / 255, g / count / 255, b / count / 255)
}

function extractMaterialDiffuse(material: Material): Color {
  if (!isColorMaterial(material)) {
    return new Color(VIEWER_FALLBACK)
  }

  const diffuse = material.color.clone()
  if ('map' in material && material.map) {
    const mapColor = sampleTextureAverage(material.map)
    if (mapColor) diffuse.multiply(mapColor)
  }
  return diffuse
}

function resolveMaterials(material: Material | Material[]): Material[] {
  if (Array.isArray(material)) {
    return material.filter(Boolean)
  }
  return material ? [material] : []
}

function materialForTriangle(
  geometry: BufferGeometry,
  materials: Material[],
  triangleIndex: number,
): Material {
  if (materials.length <= 1) {
    return materials[0] ?? new MeshStandardMaterial()
  }

  const indexOffset = triangleIndex * 3
  for (const group of geometry.groups) {
    if (indexOffset >= group.start && indexOffset < group.start + group.count) {
      return materials[group.materialIndex ?? 0] ?? materials[0]
    }
  }

  return materials[0] ?? new MeshStandardMaterial()
}

function averageVertexColor(
  geometry: BufferGeometry,
  triangleIndices: readonly number[],
): Color | null {
  const colorAttr = geometry.getAttribute('color')
  if (!colorAttr || triangleIndices.length === 0) return null

  const index = geometry.index
  let r = 0
  let g = 0
  let b = 0
  let count = 0

  for (const triangleIndex of triangleIndices) {
    for (let k = 0; k < 3; k++) {
      const vertexIndex = index ? index.getX(triangleIndex * 3 + k) : triangleIndex * 3 + k
      r += colorAttr.getX(vertexIndex)
      g += colorAttr.getY(vertexIndex)
      b += colorAttr.getZ(vertexIndex)
      count++
    }
  }

  if (count === 0) return null
  return new Color(r / count, g / count, b / count)
}

/**
 * Derive the visible surface color for a mesh region, accounting for vertex colors,
 * multi-material groups, and diffuse texture maps (common in 3MF and GLB exports).
 */
export function extractMeshSurfaceColor(
  geometry: BufferGeometry,
  materials: Material | Material[],
  triangleIndices: readonly number[],
): Color {
  const materialList = resolveMaterials(materials)
  const vertexColor = averageVertexColor(geometry, triangleIndices)

  const materialColors: Color[] = []
  const seen = new Set<string>()
  for (const triangleIndex of triangleIndices) {
    const material = materialForTriangle(geometry, materialList, triangleIndex)
    const key = materialList.indexOf(material)
    const dedupeKey = key >= 0 ? String(key) : material.uuid
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    materialColors.push(extractMaterialDiffuse(material))
  }

  if (materialColors.length === 0) {
    materialColors.push(
      extractMaterialDiffuse(materialList[0] ?? new MeshStandardMaterial()),
    )
  }

  const materialAverage = new Color()
  for (const color of materialColors) materialAverage.add(color)
  materialAverage.multiplyScalar(1 / materialColors.length)

  if (vertexColor) {
    materialAverage.multiply(vertexColor)
  }

  return materialAverage
}

function resolveDominantMaterial(
  geometry: BufferGeometry,
  materials: Material | Material[],
  triangleIndices: readonly number[],
): Material {
  const materialList = resolveMaterials(materials)
  if (triangleIndices.length === 0) {
    return materialList[0] ?? new MeshStandardMaterial()
  }
  return materialForTriangle(geometry, materialList, triangleIndices[0])
}

export { resolveDominantMaterial as resolveMeshRegionMaterial }
