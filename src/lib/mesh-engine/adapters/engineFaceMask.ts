/**
 * Per-vertex exclusion weights for BumpMesh subdivision/displacement.
 * Weight > 0.99 → skip; committed faces use 0.
 */
export function buildFaceWeights(
  triangleCount: number,
  committedTriangleIndices: ReadonlySet<number>,
): Float32Array | null {
  if (committedTriangleIndices.size === 0) return null

  const weights = new Float32Array(triangleCount * 3)
  let hasExcluded = false

  for (let t = 0; t < triangleCount; t++) {
    const excluded = !committedTriangleIndices.has(t)
    if (excluded) hasExcluded = true
    const w = excluded ? 1.0 : 0.0
    const o = t * 3
    weights[o] = w
    weights[o + 1] = w
    weights[o + 2] = w
  }

  return hasExcluded ? weights : null
}

export function collectCommittedTriangles(
  triangleIndicesList: readonly (readonly number[])[],
): Set<number> {
  const set = new Set<number>()
  for (const tris of triangleIndicesList) {
    for (const t of tris) set.add(t)
  }
  return set
}

/** Per-original-triangle membership mask for one pattern region — 1 = belongs to this region. */
export function buildTriangleSet(triangleCount: number, triangleIndices: readonly number[]): Uint8Array {
  const set = new Uint8Array(triangleCount)
  for (const t of triangleIndices) set[t] = 1
  return set
}
