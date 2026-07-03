import { BufferGeometry, Uint16BufferAttribute, Uint32BufferAttribute } from 'three'

/**
 * Return a geometry clone with an index buffer. Non-indexed meshes (STL, many
 * 3MF/OBJ loads) are converted by assigning sequential indices per vertex.
 */
export function ensureIndexedGeometry(geometry: BufferGeometry): BufferGeometry {
  const indexed = geometry.clone()
  const position = indexed.getAttribute('position')
  if (!position || position.count < 3) {
    throw new Error('Geometry has no triangle data.')
  }

  if (!indexed.index) {
    const count = position.count
    if (count > 65535) {
      const indices = new Uint32Array(count)
      for (let i = 0; i < count; i++) indices[i] = i
      indexed.setIndex(new Uint32BufferAttribute(indices, 1))
    } else {
      const indices = new Uint16Array(count)
      for (let i = 0; i < count; i++) indices[i] = i
      indexed.setIndex(new Uint16BufferAttribute(indices, 1))
    }
  }

  return indexed
}

/** True when geometry can be split into material groups for pattern apply. */
export function isGeometryPatternReady(geometry: BufferGeometry): boolean {
  const position = geometry.getAttribute('position')
  return !!position && position.count >= 3
}
