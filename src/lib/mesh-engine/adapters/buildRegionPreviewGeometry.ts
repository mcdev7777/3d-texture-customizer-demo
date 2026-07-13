import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Build a non-indexed BufferGeometry for one pattern region's fast GPU preview
 * (see patternPreviewShaderMaterial.ts), from the world-space triangle soup
 * (`positions`, 9 floats per triangle).
 *
 * Two things this does beyond a plain triangle copy:
 *
 *  1. **Uniform tessellation.** Physical vertex displacement can only show a
 *     pattern's height where there are vertices to move; the raw model mesh is
 *     too coarse. Every triangle is split into the SAME number of segments so
 *     shared edges match exactly (no T-junctions → no cracks) — the watertight
 *     analogue of BumpMesh subdividing before its displacement preview.
 *
 *  2. **A boundary skirt.** The region surface is displaced outward, so its
 *     perimeter lifts off the surrounding (undisplaced) surface and would
 *     otherwise float with a gap under it. For every boundary edge (one that
 *     belongs to a single region triangle) a vertical wall is generated from
 *     the displaced top edge down to the original surface level, closing the
 *     region into the rest of the model.
 *
 * Attributes produced (consumed by the preview shader):
 *   - position   : original (undisplaced) positions
 *   - normal     : lighting normal (smooth on the surface, sideways on walls)
 *   - ppDispDir  : direction + projection normal used for displacement; shared
 *                  between a surface boundary vertex and the skirt-top vertex at
 *                  the same position so the seam stays welded once displaced
 *   - ppDispScale: 1 where the vertex should displace, 0 at the skirt bottom
 *                  (which stays pinned to the original surface)
 */
export function buildRegionPreviewGeometry(
  positions: Float32Array,
  triangleIndices: readonly number[],
  targetEdge = 0,
  triangleBudget = 600_000,
): BufferGeometry {
  const soupTriCount = positions.length / 9
  const QUANT = 1e5
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x * QUANT)},${Math.round(y * QUANT)},${Math.round(z * QUANT)}`

  const validTris: number[] = []
  for (const t of triangleIndices) {
    if (t >= 0 && t < soupTriCount) validTris.push(t)
  }

  // ── One uniform subdivision level for every triangle (watertight). ──
  let n = 1
  if (targetEdge > 0 && validTris.length > 0) {
    const longest: number[] = []
    for (const t of validTris) {
      const o = t * 9
      const ax = positions[o]!, ay = positions[o + 1]!, az = positions[o + 2]!
      const bx = positions[o + 3]!, by = positions[o + 4]!, bz = positions[o + 5]!
      const cx = positions[o + 6]!, cy = positions[o + 7]!, cz = positions[o + 8]!
      longest.push(
        Math.max(
          Math.hypot(bx - ax, by - ay, bz - az),
          Math.hypot(cx - bx, cy - by, cz - bz),
          Math.hypot(ax - cx, ay - cy, az - cz),
        ),
      )
    }
    longest.sort((a, b) => a - b)
    const medianLongest = longest[Math.floor(longest.length / 2)]!
    n = Math.max(1, Math.min(64, Math.ceil(medianLongest / targetEdge)))
    const nBudget = Math.floor(Math.sqrt(triangleBudget / Math.max(validTris.length, 1)))
    n = Math.max(1, Math.min(n, nBudget))
  }

  // ── Boundary edges: corner-key edge shared by exactly one region triangle. ──
  interface BoundaryEdge {
    ax: number; ay: number; az: number
    bx: number; by: number; bz: number
    // third (opposite) corner, for the outward direction
    cx: number; cy: number; cz: number
  }
  const edgeMap = new Map<string, BoundaryEdge & { count: number }>()
  for (const t of validTris) {
    const o = t * 9
    const c = [
      [positions[o]!, positions[o + 1]!, positions[o + 2]!],
      [positions[o + 3]!, positions[o + 4]!, positions[o + 5]!],
      [positions[o + 6]!, positions[o + 7]!, positions[o + 8]!],
    ]
    const keys = c.map((p) => keyOf(p[0]!, p[1]!, p[2]!))
    for (let e = 0; e < 3; e++) {
      const i0 = e, i1 = (e + 1) % 3, i2 = (e + 2) % 3
      const k0 = keys[i0]!, k1 = keys[i1]!
      const edgeKey = k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`
      const existing = edgeMap.get(edgeKey)
      if (existing) {
        existing.count++
      } else {
        edgeMap.set(edgeKey, {
          ax: c[i0]![0]!, ay: c[i0]![1]!, az: c[i0]![2]!,
          bx: c[i1]![0]!, by: c[i1]![1]!, bz: c[i1]![2]!,
          cx: c[i2]![0]!, cy: c[i2]![1]!, cz: c[i2]![2]!,
          count: 1,
        })
      }
    }
  }
  const boundaryEdges: BoundaryEdge[] = []
  for (const e of edgeMap.values()) if (e.count === 1) boundaryEdges.push(e)

  // ── Allocate: surface verts + skirt verts. ──
  const surfaceTris = validTris.length * n * n
  const surfaceVerts = surfaceTris * 3
  const skirtVerts = boundaryEdges.length * n * 6 // n quads per edge, 6 verts each
  const vCount = surfaceVerts + skirtVerts

  const pos = new Float32Array(vCount * 3)
  const nrm = new Float32Array(vCount * 3)
  const dispDir = new Float32Array(vCount * 3)
  const dispScale = new Float32Array(vCount)

  // ── Pass 1: surface, accumulating welded (area-weighted) normals. ──
  const keyToNormal = new Map<string, [number, number, number]>()
  const surfaceKeys = new Array<string>(surfaceVerts)
  let w = 0
  const emitSurface = (x: number, y: number, z: number, wnx: number, wny: number, wnz: number) => {
    const base = w * 3
    pos[base] = x
    pos[base + 1] = y
    pos[base + 2] = z
    dispScale[w] = 1
    const key = keyOf(x, y, z)
    surfaceKeys[w] = key
    const acc = keyToNormal.get(key)
    if (acc) {
      acc[0] += wnx
      acc[1] += wny
      acc[2] += wnz
    } else {
      keyToNormal.set(key, [wnx, wny, wnz])
    }
    w++
  }

  for (const t of validTris) {
    const o = t * 9
    const ax = positions[o]!, ay = positions[o + 1]!, az = positions[o + 2]!
    const bx = positions[o + 3]!, by = positions[o + 4]!, bz = positions[o + 5]!
    const cx = positions[o + 6]!, cy = positions[o + 7]!, cz = positions[o + 8]!
    const abx = bx - ax, aby = by - ay, abz = bz - az
    const acx = cx - ax, acy = cy - ay, acz = cz - az
    const wnx = aby * acz - abz * acy
    const wny = abz * acx - abx * acz
    const wnz = abx * acy - aby * acx

    const P = (u: number, v: number): [number, number, number] => [
      ax + abx * (u / n) + acx * (v / n),
      ay + aby * (u / n) + acy * (v / n),
      az + abz * (u / n) + acz * (v / n),
    ]
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n - row; col++) {
        const p0 = P(col, row), p1 = P(col + 1, row), p2 = P(col, row + 1)
        emitSurface(p0[0], p0[1], p0[2], wnx, wny, wnz)
        emitSurface(p1[0], p1[1], p1[2], wnx, wny, wnz)
        emitSurface(p2[0], p2[1], p2[2], wnx, wny, wnz)
        if (col < n - row - 1) {
          const p3 = P(col + 1, row + 1)
          emitSurface(p1[0], p1[1], p1[2], wnx, wny, wnz)
          emitSurface(p3[0], p3[1], p3[2], wnx, wny, wnz)
          emitSurface(p2[0], p2[1], p2[2], wnx, wny, wnz)
        }
      }
    }
  }

  // Welded unit normal per position.
  const keyToUnit = new Map<string, [number, number, number]>()
  for (const [key, acc] of keyToNormal) {
    const l = Math.hypot(acc[0], acc[1], acc[2])
    keyToUnit.set(key, l > 1e-9 ? [acc[0] / l, acc[1] / l, acc[2] / l] : [0, 0, 1])
  }

  // Pass 2: assign surface lighting normal + displacement direction.
  for (let v = 0; v < surfaceVerts; v++) {
    const u = keyToUnit.get(surfaceKeys[v]!)!
    const base = v * 3
    nrm[base] = u[0]; nrm[base + 1] = u[1]; nrm[base + 2] = u[2]
    dispDir[base] = u[0]; dispDir[base + 1] = u[1]; dispDir[base + 2] = u[2]
  }

  // ── Pass 3: skirts. Each boundary edge → n stacked quads (top displaces
  // with the surface, bottom pinned to the original surface). ──
  const emitSkirt = (
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number, // displacement dir (welded surface normal)
    wallX: number, wallY: number, wallZ: number, // lighting normal
    scale: number,
  ) => {
    const base = w * 3
    pos[base] = x; pos[base + 1] = y; pos[base + 2] = z
    dispDir[base] = dx; dispDir[base + 1] = dy; dispDir[base + 2] = dz
    nrm[base] = wallX; nrm[base + 1] = wallY; nrm[base + 2] = wallZ
    dispScale[w] = scale
    w++
  }

  for (const edge of boundaryEdges) {
    const ex = edge.bx - edge.ax, ey = edge.by - edge.ay, ez = edge.bz - edge.az
    // Face normal of the parent triangle.
    const acx = edge.cx - edge.ax, acy = edge.cy - edge.ay, acz = edge.cz - edge.az
    let fnx = ey * acz - ez * acy
    let fny = ez * acx - ex * acz
    let fnz = ex * acy - ey * acx
    const fl = Math.hypot(fnx, fny, fnz) || 1
    fnx /= fl; fny /= fl; fnz /= fl
    // Wall normal: perpendicular to the edge and to the face normal, flipped
    // to point away from the triangle's interior (the opposite corner C).
    let wnx = ey * fnz - ez * fny
    let wny = ez * fnx - ex * fnz
    let wnz = ex * fny - ey * fnx
    const wl = Math.hypot(wnx, wny, wnz) || 1
    wnx /= wl; wny /= wl; wnz /= wl
    const midX = (edge.ax + edge.bx) / 2, midY = (edge.ay + edge.by) / 2, midZ = (edge.az + edge.bz) / 2
    const outX = midX - edge.cx, outY = midY - edge.cy, outZ = midZ - edge.cz
    if (wnx * outX + wny * outY + wnz * outZ < 0) {
      wnx = -wnx; wny = -wny; wnz = -wnz
    }

    for (let s = 0; s < n; s++) {
      const t0 = s / n, t1 = (s + 1) / n
      const x0 = edge.ax + ex * t0, y0 = edge.ay + ey * t0, z0 = edge.az + ez * t0
      const x1 = edge.ax + ex * t1, y1 = edge.ay + ey * t1, z1 = edge.az + ez * t1
      const d0 = keyToUnit.get(keyOf(x0, y0, z0)) ?? [fnx, fny, fnz]
      const d1 = keyToUnit.get(keyOf(x1, y1, z1)) ?? [fnx, fny, fnz]

      // Quad: top0,top1 (scale 1) → bottom1,bottom0 (scale 0).
      // Triangle A: top0, top1, bottom1
      emitSkirt(x0, y0, z0, d0[0], d0[1], d0[2], wnx, wny, wnz, 1)
      emitSkirt(x1, y1, z1, d1[0], d1[1], d1[2], wnx, wny, wnz, 1)
      emitSkirt(x1, y1, z1, d1[0], d1[1], d1[2], wnx, wny, wnz, 0)
      // Triangle B: top0, bottom1, bottom0
      emitSkirt(x0, y0, z0, d0[0], d0[1], d0[2], wnx, wny, wnz, 1)
      emitSkirt(x1, y1, z1, d1[0], d1[1], d1[2], wnx, wny, wnz, 0)
      emitSkirt(x0, y0, z0, d0[0], d0[1], d0[2], wnx, wny, wnz, 0)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nrm, 3))
  geo.setAttribute('ppDispDir', new BufferAttribute(dispDir, 3))
  geo.setAttribute('ppDispScale', new BufferAttribute(dispScale, 1))
  return geo
}
