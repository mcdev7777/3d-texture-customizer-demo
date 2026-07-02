/**
 * Minimal sanity checks for pattern placement math (run with: node scripts/test-bake-math.mjs)
 */

function getPatternRepeat(scale) {
  return Math.max(0.25, scale) * 2
}

function mapPanelUVToPatternUV(panelU, panelV, settings) {
  const repeat = getPatternRepeat(settings.scale)
  const offsetU = settings.offsetX * 0.35
  const offsetV = -settings.offsetY * 0.35
  const rad = (settings.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  let u = panelU - 0.5
  let v = panelV - 0.5
  const ru = u * cos - v * sin + 0.5
  const rv = u * sin + v * cos + 0.5

  const pu = ru * repeat + offsetU
  const pv = rv * repeat + offsetV

  return [pu - Math.floor(pu), pv - Math.floor(pv)]
}

function assert(name, condition) {
  if (!condition) {
    console.error(`FAIL: ${name}`)
    process.exit(1)
  }
  console.log(`OK: ${name}`)
}

const settings = { scale: 1, rotation: 0, offsetX: 0, offsetY: 0 }
const [u, v] = mapPanelUVToPatternUV(0.5, 0.5, settings)
assert('center maps with repeat 2 (wraps to 0)', Math.abs(u) < 0.001 && Math.abs(v) < 0.001)

const rotated = mapPanelUVToPatternUV(0.5, 0.5, { ...settings, rotation: 360 })
assert('360 rotation preserves center', Math.abs(rotated[0] - u) < 0.01)

// Engrave/emboss displacement direction (mirrors getDisplacementAmount)
function getDisplacementAmount(mask, mode, depthWorld) {
  const h = Math.min(1, Math.max(0, mask))
  return mode === 'engrave' ? (1 - h) * depthWorld : h * depthWorld
}

assert('emboss raises mask peaks', getDisplacementAmount(1, 'emboss', 0.1) > 0.09)
assert('emboss keeps background flat', Math.abs(getDisplacementAmount(0, 'emboss', 0.1)) < 1e-9)
assert('engrave differs from emboss', getDisplacementAmount(1, 'engrave', 0.1) !== getDisplacementAmount(1, 'emboss', 0.1))
assert('engrave carves peaks down to surface', Math.abs(getDisplacementAmount(1, 'engrave', 0.1)) < 1e-9)
assert('engrave raises background slab', getDisplacementAmount(0, 'engrave', 0.1) > 0.09)

console.log('All bake math checks passed.')
