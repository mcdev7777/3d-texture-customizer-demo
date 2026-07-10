import { Matrix4, Vector3, type BufferGeometry } from 'three'

/**
 * A fitted cylinder for a selected region, in the same (world) space as the
 * mesh's transformed vertices. `axis` is unit-length; `center` is a point on
 * the axis line; `right`/`up` are an orthonormal basis spanning the plane
 * perpendicular to the axis (used to measure the go-around angle).
 */
export interface CylinderFit {
  axis: Vector3
  center: Vector3
  right: Vector3
  up: Vector3
  radius: number
}

const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _ab = new Vector3()
const _ac = new Vector3()
const _n = new Vector3()

/** Jacobi eigen-decomposition of a symmetric 3×3 matrix (row-major 3×3). */
function jacobiEigen(m: number[]): { values: number[]; vectors: number[][] } {
  // Work on a mutable copy.
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ]
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  for (let sweep = 0; sweep < 50; sweep++) {
    // Largest off-diagonal magnitude.
    let p = 0
    let q = 1
    let max = Math.abs(a[0][1])
    const offs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 2],
    ]
    for (const [i, j] of offs) {
      if (Math.abs(a[i][j]) >= max) {
        max = Math.abs(a[i][j])
        p = i
        q = j
      }
    }
    if (max < 1e-12) break

    const app = a[p][p]
    const aqq = a[q][q]
    const apq = a[p][q]
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app)
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)

    for (let k = 0; k < 3; k++) {
      const akp = a[k][p]
      const akq = a[k][q]
      a[k][p] = cos * akp - sin * akq
      a[k][q] = sin * akp + cos * akq
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k]
      const aqk = a[q][k]
      a[p][k] = cos * apk - sin * aqk
      a[q][k] = sin * apk + cos * aqk
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p]
      const vkq = v[k][q]
      v[k][p] = cos * vkp - sin * vkq
      v[k][q] = sin * vkp + cos * vkq
    }
  }

  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [
      [v[0][0], v[1][0], v[2][0]],
      [v[0][1], v[1][1], v[2][1]],
      [v[0][2], v[1][2], v[2][2]],
    ],
  }
}

function orthonormalBasis(axis: Vector3): { right: Vector3; up: Vector3 } {
  const ref = Math.abs(axis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0)
  const right = new Vector3().crossVectors(ref, axis).normalize()
  const up = new Vector3().crossVectors(axis, right).normalize()
  return { right, up }
}

export interface DetectCylinderOptions {
  /** Max allowed radius residual (stddev / radius) for a valid fit. */
  radiusTolerance?: number
  /** Min mean |normal · radialDirection| for a valid fit (how radial normals are). */
  minRadialAlignment?: number
}

/**
 * Fit a cylinder to a region's triangles (given in the mesh's local geometry,
 * transformed to world space by `matrixWorld`). Returns null when the triangles
 * don't form a convincing cylindrical band — a flat or box-like selection fails
 * the radius/alignment checks and falls back to the caller's default mapping.
 *
 * Method: the cylinder axis is the direction the surface normals are most
 * perpendicular to (smallest-eigenvalue eigenvector of the area-weighted normal
 * covariance). Vertices are projected onto the plane ⟂ axis and an algebraic
 * (Kåsa) circle fit gives the center and radius. The fit is validated by the
 * spread of per-vertex radii and how radial the normals are.
 */
export function detectCylinder(
  geometry: BufferGeometry,
  matrixWorld: Matrix4,
  triangleIndices: readonly number[],
  options: DetectCylinderOptions = {},
): CylinderFit | null {
  const radiusTolerance = options.radiusTolerance ?? 0.1
  const minRadialAlignment = options.minRadialAlignment ?? 0.8

  if (triangleIndices.length < 8) return null

  const index = geometry.index
  const pos = geometry.getAttribute('position')
  if (!pos) return null

  const getWorld = (vi: number, out: Vector3) =>
    out.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(matrixWorld)

  // Area-weighted normal covariance + world-space vertex accumulation.
  const cov = new Array(9).fill(0)
  const verts: number[] = []
  const faceNormals: number[] = []
  const faceCentroids: number[] = []
  let totalArea = 0
  const centroid = new Vector3()
  let vertCount = 0

  for (const t of triangleIndices) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    getWorld(i0, _a)
    getWorld(i1, _b)
    getWorld(i2, _c)
    _ab.subVectors(_b, _a)
    _ac.subVectors(_c, _a)
    _n.crossVectors(_ab, _ac)
    const area = 0.5 * _n.length()
    if (area < 1e-12) continue
    _n.normalize()
    totalArea += area

    // Area-weighted n ⊗ n.
    const nx = _n.x
    const ny = _n.y
    const nz = _n.z
    cov[0] += area * nx * nx
    cov[1] += area * nx * ny
    cov[2] += area * nx * nz
    cov[3] += area * ny * nx
    cov[4] += area * ny * ny
    cov[5] += area * ny * nz
    cov[6] += area * nz * nx
    cov[7] += area * nz * ny
    cov[8] += area * nz * nz

    faceNormals.push(nx, ny, nz)
    const fcx = (_a.x + _b.x + _c.x) / 3
    const fcy = (_a.y + _b.y + _c.y) / 3
    const fcz = (_a.z + _b.z + _c.z) / 3
    faceCentroids.push(fcx, fcy, fcz)

    for (const v of [_a, _b, _c]) {
      verts.push(v.x, v.y, v.z)
      centroid.add(v)
      vertCount++
    }
  }

  if (totalArea < 1e-12 || vertCount < 8) return null
  centroid.multiplyScalar(1 / vertCount)

  // Axis = eigenvector with the SMALLEST eigenvalue (normals lie in the plane
  // perpendicular to the axis, so they contribute least along it).
  const { values, vectors } = jacobiEigen(cov)
  let minIdx = 0
  if (values[1] < values[minIdx]) minIdx = 1
  if (values[2] < values[minIdx]) minIdx = 2
  const axis = new Vector3(vectors[minIdx][0], vectors[minIdx][1], vectors[minIdx][2]).normalize()
  if (axis.lengthSq() < 0.5) return null

  const { right, up } = orthonormalBasis(axis)

  // Project vertices onto the (right, up) plane relative to centroid, then do
  // an algebraic circle fit: minimize |x²+y² - (A·x + B·y + C)|.
  let Sx = 0
  let Sy = 0
  let Sxx = 0
  let Syy = 0
  let Sxy = 0
  let Sxz = 0
  let Syz = 0
  let Sz = 0
  const n = vertCount
  const px: number[] = []
  const py: number[] = []
  for (let i = 0; i < n; i++) {
    _a.set(verts[i * 3] - centroid.x, verts[i * 3 + 1] - centroid.y, verts[i * 3 + 2] - centroid.z)
    const x = _a.dot(right)
    const y = _a.dot(up)
    px.push(x)
    py.push(y)
    const z = x * x + y * y
    Sx += x
    Sy += y
    Sxx += x * x
    Syy += y * y
    Sxy += x * y
    Sxz += x * z
    Syz += y * z
    Sz += z
  }

  // Solve the 3×3 normal equations for [A, B, C].
  const m11 = Sxx
  const m12 = Sxy
  const m13 = Sx
  const m22 = Syy
  const m23 = Sy
  const m33 = n
  const b1 = Sxz
  const b2 = Syz
  const b3 = Sz
  const det =
    m11 * (m22 * m33 - m23 * m23) -
    m12 * (m12 * m33 - m23 * m13) +
    m13 * (m12 * m23 - m22 * m13)
  if (Math.abs(det) < 1e-12) return null
  const invDet = 1 / det
  const A =
    invDet *
    (b1 * (m22 * m33 - m23 * m23) - m12 * (b2 * m33 - m23 * b3) + m13 * (b2 * m23 - m22 * b3))
  const B =
    invDet *
    (m11 * (b2 * m33 - m23 * b3) - b1 * (m12 * m33 - m23 * m13) + m13 * (m12 * b3 - b2 * m13))
  const C =
    invDet *
    (m11 * (m22 * b3 - b2 * m23) - m12 * (m12 * b3 - b2 * m13) + b1 * (m12 * m23 - m22 * m13))

  const cx = A / 2
  const cy = B / 2
  const radius = Math.sqrt(Math.max(C + cx * cx + cy * cy, 0))
  if (!(radius > 1e-6)) return null

  const center = centroid.clone().addScaledVector(right, cx).addScaledVector(up, cy)

  // Validate: per-vertex radius spread and how radial the face normals are.
  let radiusMean = 0
  for (let i = 0; i < n; i++) {
    radiusMean += Math.hypot(px[i] - cx, py[i] - cy)
  }
  radiusMean /= n
  if (!(radiusMean > 1e-6)) return null

  let radiusVar = 0
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(px[i] - cx, py[i] - cy) - radiusMean
    radiusVar += d * d
  }
  const radiusStd = Math.sqrt(radiusVar / n)
  if (radiusStd / radiusMean > radiusTolerance) return null

  // Mean |normal · radialDir| across faces (should be ≈1 for a true cylinder).
  const faceCount = faceNormals.length / 3
  let radialDot = 0
  for (let f = 0; f < faceCount; f++) {
    _a.set(
      faceCentroids[f * 3] - center.x,
      faceCentroids[f * 3 + 1] - center.y,
      faceCentroids[f * 3 + 2] - center.z,
    )
    // Radial direction = centroid-to-face projected off the axis.
    _b.copy(axis).multiplyScalar(_a.dot(axis))
    _a.sub(_b)
    if (_a.lengthSq() < 1e-12) continue
    _a.normalize()
    _n.set(faceNormals[f * 3], faceNormals[f * 3 + 1], faceNormals[f * 3 + 2])
    radialDot += Math.abs(_a.dot(_n))
  }
  radialDot /= Math.max(faceCount, 1)
  if (radialDot < minRadialAlignment) return null

  return { axis, center, right, up, radius: radiusMean }
}
