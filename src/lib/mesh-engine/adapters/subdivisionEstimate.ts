/**
 * Predicts subdivide()'s output triangle count for a candidate edge length,
 * and coarsens the edge upward until that prediction fits a triangle budget.
 *
 * Ported from BumpMesh's smartResolution.js (simTri / simulateFromEdges /
 * the iterative budgetEdge solve) — the mechanism the original app uses to
 * keep subdivision-before-decimation bounded regardless of how fine a
 * pattern's feature size is. Without it, `computeReliefEdgeTargets`'s
 * feature-size-based edge (see engineSettings.ts) is still just a *target*,
 * not a *cap*: a fine-detail pattern (small featureRadius, e.g. hex/grid)
 * on an ordinary-sized model can still imply an edge fine enough to blow
 * subdivision up to millions of triangles, which `decimate()` then has to
 * crush back down — the same "stuck at Decimating" symptom, just triggered
 * by pattern choice instead of model scale.
 */

function simTri(a: number, b: number, c: number, T: number, memo: Map<number, number>, depth: number): number {
  if (a < b) {
    const t = a
    a = b
    b = t
  }
  if (b < c) {
    const t = b
    b = c
    c = t
  }
  if (a < b) {
    const t = a
    a = b
    b = t
  }

  // Quantise relative to T for cache — matches BumpMesh's 256-bins-per-T scheme.
  const ka = Math.round((a / T) * 256)
  const kb = Math.round((b / T) * 256)
  const kc = Math.round((c / T) * 256)
  const key = ka * 0x40000000 + kb * 0x10000 + kc
  const cached = memo.get(key)
  if (cached !== undefined) return cached

  // Matches subdivide()'s 12-pass outer cap so deep slivers behave identically.
  if (depth > 12) {
    memo.set(key, 1)
    return 1
  }

  const sa = a > T
  const sb = b > T
  const sc = c > T
  const n = (sa ? 1 : 0) + (sb ? 1 : 0) + (sc ? 1 : 0)
  if (n === 0) {
    memo.set(key, 1)
    return 1
  }

  let total: number
  if (n === 3) {
    total = 4 * simTri(a / 2, b / 2, c / 2, T, memo, depth + 1)
  } else if (n === 1) {
    const m = 0.5 * Math.sqrt(Math.max(0, 2 * b * b + 2 * c * c - a * a))
    total = simTri(a / 2, b, m, T, memo, depth + 1) + simTri(a / 2, c, m, T, memo, depth + 1)
  } else {
    const m = 0.5 * Math.sqrt(Math.max(0, 2 * b * b + 2 * c * c - a * a))
    total =
      simTri(c, a / 2, m, T, memo, depth + 1) +
      simTri(m, c / 2, b / 2, T, memo, depth + 1) +
      simTri(b / 2, c / 2, a / 2, T, memo, depth + 1)
  }

  memo.set(key, total)
  return total
}

function computeTriEdges(positions: Float32Array): Float64Array {
  const triCount = positions.length / 9
  const out = new Float64Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    const o = t * 9
    const ax = positions[o]!,
      ay = positions[o + 1]!,
      az = positions[o + 2]!
    const bx = positions[o + 3]!,
      by = positions[o + 4]!,
      bz = positions[o + 5]!
    const cx = positions[o + 6]!,
      cy = positions[o + 7]!,
      cz = positions[o + 8]!
    out[t * 3] = Math.hypot(bx - ax, by - ay, bz - az)
    out[t * 3 + 1] = Math.hypot(cx - bx, cy - by, cz - bz)
    out[t * 3 + 2] = Math.hypot(ax - cx, ay - cy, az - cz)
  }
  return out
}

function simulateFromEdges(triEdges: Float64Array, edge: number): number {
  const memo = new Map<number, number>()
  const triCount = triEdges.length / 3
  let total = 0
  for (let i = 0; i < triCount; i++) {
    const o = i * 3
    const a = triEdges[o]!,
      b = triEdges[o + 1]!,
      c = triEdges[o + 2]!
    if (a <= edge && b <= edge && c <= edge) {
      total += 1
      continue
    }
    total += simTri(a, b, c, edge, memo, 0)
  }
  return total
}

/**
 * Coarsen `startEdgeMm` upward, if needed, so `subdivide()`'s predicted
 * output triangle count fits `triBudget`. Leaves the edge untouched when
 * already within budget. Mirrors BumpMesh smartResolution.js's iterative
 * budget-edge solve (ratio corrections, then a linear 5% walk to close the
 * gap on step-function meshes).
 */
export function clampEdgeToTriangleBudget(
  positions: Float32Array,
  startEdgeMm: number,
  triBudget: number,
): number {
  if (positions.length === 0 || startEdgeMm <= 0) return startEdgeMm

  const triEdges = computeTriEdges(positions)
  let edge = startEdgeMm

  for (let step = 0; step < 3; step++) {
    const count = simulateFromEdges(triEdges, edge)
    if (count <= triBudget) return edge
    const correction = Math.sqrt(count / triBudget)
    if (correction < 1.005) break
    edge *= correction
  }
  for (let step = 0; step < 24; step++) {
    if (simulateFromEdges(triEdges, edge) <= triBudget) break
    edge *= 1.05
  }
  return edge
}
