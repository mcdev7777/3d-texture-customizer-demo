/**
 * Minimal sanity checks for relief math (run with: node scripts/test-bake-math.mjs).
 * These mirror the TypeScript helpers in src/lib/textures.
 */

const BASE_TILE_WORLD = 0.6

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function worldToPatternUV(uWorld, vWorld, s) {
  const tile = BASE_TILE_WORLD / Math.max(0.05, s.scale)
  const rad = (s.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ru = uWorld * cos - vWorld * sin
  const rv = uWorld * sin + vWorld * cos
  return [ru / tile + s.offsetX, rv / tile + s.offsetY]
}

function applyContrast(v, c = 1.35) {
  return clamp01((v - 0.5) * c + 0.5)
}

function applyRoundedProfile(v) {
  const h = clamp01(v)
  return h * h * (3 - 2 * h)
}

function getReliefDisplacement(mask, mode, depth) {
  const shaped = applyRoundedProfile(applyContrast(mask))
  return mode === 'engrave' ? (1 - shaped) * depth : shaped * depth
}

// Grid evaluator (mirror of patternEvaluators.grid)
function frac(x) {
  return x - Math.floor(x)
}
function distToNearestInt(x) {
  return Math.abs(frac(x + 0.5) - 0.5)
}
function grid(u, v) {
  const d = Math.min(distToNearestInt(u), distToNearestInt(v))
  return 1 - smoothstep(0.06, 0.11, d)
}

function assert(name, condition) {
  if (!condition) {
    console.error(`FAIL: ${name}`)
    process.exit(1)
  }
  console.log(`OK: ${name}`)
}

const s = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }

// Pattern UV mapping is physically consistent: same tile size regardless of patch.
const [u0] = worldToPatternUV(0, 0, s)
const [uTile] = worldToPatternUV(BASE_TILE_WORLD, 0, s)
assert('origin maps to tile 0', Math.abs(u0) < 1e-9)
assert('one tile of world = one pattern period', Math.abs(uTile - 1) < 1e-9)

const [uHalf] = worldToPatternUV(BASE_TILE_WORLD, 0, { ...s, scale: 2 })
assert('scale 2 doubles density', Math.abs(uHalf - 2) < 1e-9)

// Rounded relief profile
assert('profile(0) = 0', applyRoundedProfile(0) === 0)
assert('profile(1) = 1', applyRoundedProfile(1) === 1)
assert('profile(0.5) = 0.5', Math.abs(applyRoundedProfile(0.5) - 0.5) < 1e-9)
assert(
  'profile is smooth/monotonic',
  applyRoundedProfile(0.25) < applyRoundedProfile(0.5) &&
    applyRoundedProfile(0.5) < applyRoundedProfile(0.75),
)

// Emboss vs engrave displacement
assert('emboss raises mask peaks', getReliefDisplacement(1, 'emboss', 0.1) > 0.09)
assert('emboss keeps background flat', Math.abs(getReliefDisplacement(0, 'emboss', 0.1)) < 1e-9)
assert(
  'engrave differs from emboss',
  getReliefDisplacement(1, 'engrave', 0.1) !== getReliefDisplacement(1, 'emboss', 0.1),
)
assert('engrave carves peaks to surface', Math.abs(getReliefDisplacement(1, 'engrave', 0.1)) < 1e-9)
assert('engrave raises background slab', getReliefDisplacement(0, 'engrave', 0.1) > 0.09)

// Procedural evaluator: smooth, bounded, periodic, clear line
assert('grid line core is high', grid(0, 0) > 0.9)
assert('grid cell center is low', grid(0.5, 0.5) < 0.1)
assert('grid is periodic', Math.abs(grid(0, 0) - grid(1, 1)) < 1e-9)
assert(
  'grid edges are soft (not binary)',
  grid(0.08, 0.5) > 0.05 && grid(0.08, 0.5) < 0.95,
)

console.log('All relief math checks passed.')
