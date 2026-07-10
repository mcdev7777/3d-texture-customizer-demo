/**
 * Headless export-pipeline verification harness.
 *
 * Runs the REAL worker mesh-engine pipeline (runExportPipeline) in Node on a
 * synthetic closed box + hard-edged heightmap, across a sweep of Surface-
 * Smoothness values, and asserts the print invariant on the FINAL geometry:
 *   0 open edges, 0 non-manifold edges, 0 area slivers.
 * Also reports triangle count, STL byte size, and bake time per run so
 * before/after comparisons (Step 3) are measurable.
 *
 * Usage: node scripts/verify-export.mjs
 * Exit code 0 = all invariants hold; 1 = a defect was found (fails loudly).
 */
import { runExportPipeline } from '../src/lib/mesh-engine/exportPipeline.js'
import { countEdgeDefects, countAreaSlivers } from '../src/lib/mesh-engine/meshRepair.js'

// Mirror of engineSettings.ts smoothnessToIterations (kept in sync manually —
// this harness runs in plain Node and can't import the .ts adapter).
const MAX_SMOOTHING_ITERATIONS = 14
const smoothnessToIterations = (v) =>
  Math.round((Math.max(0, Math.min(100, v)) / 100) * MAX_SMOOTHING_ITERATIONS)

// ── Synthetic closed box (watertight, real 90° creases) ──────────────────────
// Axis-aligned box in mm. 12 triangles, outward-facing winding.
function makeBox(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  // 8 corners
  const c = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], // z-
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], //   z+
  ]
  // 6 faces (CCW outward), each 2 tris
  const quads = [
    [0, 3, 2, 1], // z- (facing -z)
    [4, 5, 6, 7], // z+
    [0, 1, 5, 4], // y-
    [2, 3, 7, 6], // y+
    [1, 2, 6, 5], // x+
    [0, 4, 7, 3], // x-
  ]
  const pos = []
  const tri = (a, b, cc) => { pos.push(...c[a], ...c[b], ...c[cc]) }
  for (const [a, b, cc, d] of quads) { tri(a, b, cc); tri(a, cc, d) }
  return new Float32Array(pos)
}

// Closed cylinder (radius r, height h, n segments) — real circular top/bottom
// rims with a ~90° crease between the flat cap and the curved wall. This is the
// exact "curved circular edge" case that stresses the crease-loop tangential
// relax in smoothing.js.
function makeCylinder(r, h, n) {
  const hz = h / 2
  const pos = []
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => pos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r
    // wall (two tris, outward)
    tri(x0, y0, -hz, x1, y1, -hz, x1, y1, hz)
    tri(x0, y0, -hz, x1, y1, hz, x0, y0, hz)
    // top cap (fan, facing +z)
    tri(0, 0, hz, x0, y0, hz, x1, y1, hz)
    // bottom cap (fan, facing -z)
    tri(0, 0, -hz, x1, y1, -hz, x0, y0, -hz)
  }
  return new Float32Array(pos)
}

function boundsOf(positions) {
  let minx = Infinity, miny = Infinity, minz = Infinity
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minx) minx = x; if (x > maxx) maxx = x
    if (y < miny) miny = y; if (y > maxy) maxy = y
    if (z < minz) minz = z; if (z > maxz) maxz = z
  }
  const mk = (x, y, z) => ({ x, y, z })
  return {
    min: mk(minx, miny, minz),
    max: mk(maxx, maxy, maxz),
    size: mk(maxx - minx, maxy - miny, maxz - minz),
    center: mk((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2),
  }
}

// Two worst cases: hard-edged checkerboard (boundary aliasing) AND
// high-frequency per-texel noise (dense displacement spikes that stress the
// smoother into potential weld-collision non-manifold edges). Both must stay
// print-safe.
function makeHardHeightmap(size, cells) {
  const data = new Uint8ClampedArray(size * size * 4)
  const cell = size / cells
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0
      const g = on ? 255 : 0
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = g
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

function makeNoiseHeightmap(size) {
  const data = new Uint8ClampedArray(size * size * 4)
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  for (let i = 0; i < size * size; i++) {
    const g = (rnd() * 255) | 0
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g
    data[i * 4 + 3] = 255
  }
  return { data, width: size, height: size }
}

function makeSettings(smoothingIterations) {
  return {
    mappingMode: 5, // MODE_TRIPLANAR
    scaleU: 1, scaleV: 1,
    amplitude: 1.2, // mm
    offsetU: 0, offsetV: 0, rotation: 0,
    invertDisplacement: false,
    symmetricDisplacement: false,
    mappingBlend: 1,
    seamBandWidth: 0.5,
    blendNormalSmoothing: 16,
    refineLength: 0.8, // mm — coarse enough to run fast, fine enough to displace
    maxTriangles: 120_000,
    bottomAngleLimit: 5,
    topAngleLimit: 0,
    smoothBottom: true,
    harvestFlatFaces: true,
    harvestTol: 0.005,
    regularizeEnabled: true,
    regularizeSecondPassMul: 1.1,
    boundaryFalloff: 0,
    noDownwardZ: false,
    smoothingIterations,
  }
}

const regularizeOpts = {
  aspectThreshold: 5,
  slack: 3.0,
  aggressiveSlack: 8.0,
  extremeSliverAspect: 8,
  maxNormalDeltaCos: Math.cos((15 * Math.PI) / 180),
  aggressiveNormalDeltaCos: Math.cos((25 * Math.PI) / 180),
}

async function runOne(smoothness, shape, pattern) {
  const positions = shape === 'cylinder' ? makeCylinder(12, 8, 64) : makeBox(20, 20, 10)
  const bounds = boundsOf(positions)
  const imageData = pattern === 'noise' ? makeNoiseHeightmap(256) : makeHardHeightmap(256, 8)
  const iterations = smoothnessToIterations(smoothness)
  const t0 = Date.now()
  const result = await runExportPipeline(
    {
      positions,
      faceWeights: null,
      imageData,
      imgWidth: imageData.width,
      imgHeight: imageData.height,
      settings: makeSettings(iterations),
      bounds,
      regularizeOpts,
      mode: 'export',
    },
    () => {},
    () => false,
  )
  const ms = Date.now() - t0
  if (!result) throw new Error('pipeline returned null')

  const geo = { attributes: { position: { array: result.positions } } }
  const defects = countEdgeDefects(geo)
  const slivers = countAreaSlivers(geo)
  const tris = result.positions.length / 9
  // STL binary size: 84 header + 50 bytes/triangle.
  const stlBytes = 84 + tris * 50
  return { smoothness, iterations, tris, ms, stlBytes, defects, slivers }
}

const SWEEP = [0, 15, 30, 60, 100]
let failed = false
for (const shape of ['box', 'cylinder']) {
  for (const pattern of ['checker', 'noise']) {
  console.log(`\n── ${shape} / ${pattern} ──`)
  console.log('smooth  iters   tris     time     STL(MB)  open  nonManif  slivers')
  for (const s of SWEEP) {
    const r = await runOne(s, shape, pattern)
    const ok = r.defects.open === 0 && r.defects.nonManifold === 0 && r.slivers === 0
    if (!ok) failed = true
    console.log(
      `${String(r.smoothness).padStart(5)}  ${String(r.iterations).padStart(5)}  ` +
      `${String(r.tris).padStart(7)}  ${String(r.ms).padStart(5)}ms  ` +
      `${(r.stlBytes / 1e6).toFixed(2).padStart(6)}   ` +
      `${String(r.defects.open).padStart(4)}  ${String(r.defects.nonManifold).padStart(8)}  ` +
      `${String(r.slivers).padStart(7)}  ${ok ? 'OK' : '❌ DEFECT'}`,
    )
  }
  }
}

if (failed) {
  console.error('\n❌ INVARIANT VIOLATED: exported mesh has open/non-manifold/sliver defects.')
  process.exit(1)
}
console.log('\n✅ All smoothness levels produced watertight, manifold, sliver-free geometry.')
