/**
 * Tuning harness: measure curved-rim fillet size directly from taubinSmooth
 * (not the whole pipeline) as a function of moveClampFactor + iterations, to
 * find settings that make curved edges dramatically softer while staying
 * watertight. Fillet size = how far the rounded shoulder reaches down from
 * the sharp corner, in mm — bigger = softer.
 */
import { taubinSmooth } from '../src/lib/mesh-engine/smoothing.js'
import { countEdgeDefects, countAreaSlivers } from '../src/lib/mesh-engine/meshRepair.js'
import { THREE } from '../src/lib/mesh-engine/threeCompat.js'

const R = 12, H = 8, N = 64, RINGS = 16 // vertical wall subdivisions, dense near a rim
function makeCylinder(r, h, n, rings) {
  const hz = h / 2
  const pos = []
  const tri = (...v) => pos.push(...v)
  // Wall rings from -hz to +hz (rings segments → rings+1 z-levels).
  const zAt = (k) => -hz + (k / rings) * h
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r
    for (let k = 0; k < rings; k++) {
      const z0 = zAt(k), z1 = zAt(k + 1)
      tri(x0, y0, z0, x1, y1, z0, x1, y1, z1)
      tri(x0, y0, z0, x1, y1, z1, x0, y0, z1)
    }
    // caps
    tri(0, 0, hz, x0, y0, hz, x1, y1, hz)
    tri(0, 0, -hz, x1, y1, -hz, x0, y0, -hz)
  }
  return new Float32Array(pos)
}

// Subdivide each wall triangle into a small grid so the rim has enough loop
// resolution to round smoothly (matches what the real subdivision pass does).
function subdivideWall(positions, segsAroundEach, vertSplits) {
  // Simple approach: just increase N directly instead of re-subdividing.
  return positions
}

function makeBox(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const c = [[-hx,-hy,-hz],[hx,-hy,-hz],[hx,hy,-hz],[-hx,hy,-hz],[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]]
  const q = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]]
  const pos = []
  const tri = (a,b,cc) => pos.push(...c[a],...c[b],...c[cc])
  for (const [a,b,cc,d] of q) { tri(a,b,cc); tri(a,cc,d) }
  return new Float32Array(pos)
}

function geoFrom(positions) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return g
}

function rimShoulder(pos) {
  // Max radius at the very top (sharp corner reference) vs. mean radius of the
  // ring 0.5mm below the top (how far the fillet has pulled the shoulder in).
  let maxZ = -Infinity
  for (let i = 0; i < pos.length; i += 3) if (pos[i+2] > maxZ) maxZ = pos[i+2]
  const topR = []
  const shoulderR = []
  for (let i = 0; i < pos.length; i += 3) {
    const z = pos[i+2], r = Math.hypot(pos[i], pos[i+1])
    if (r < R * 0.5) continue // exclude cap-fan interior/apex vertices
    if (z > maxZ - 0.1) topR.push(r)
    else if (z > maxZ - 2.5 && z < maxZ - 1.5) shoulderR.push(r)
  }
  const avg = (a) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : NaN
  return { topR: avg(topR), shoulderR: avg(shoulderR), filletDepth: avg(topR) - avg(shoulderR) }
}

function boxEdgeCrispness(pos) {
  // Straight top edge at x=+10. Measure max Z-drop among its vertices — how
  // far the "crisp" edge sagged (should stay ~0).
  let maxZ = -Infinity
  for (let i = 0; i < pos.length; i += 3) if (pos[i+2] > maxZ) maxZ = pos[i+2]
  let worst = 0
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i] - 10) < 0.2 && pos[i+2] > maxZ - 2) {
      const drop = maxZ - pos[i+2]
      if (drop > worst) worst = drop
    }
  }
  return worst
}

const configs = [
  { moveClampFactor: 1.5, iterations: 14 },  // current shipped
  { moveClampFactor: 3,   iterations: 14 },
  { moveClampFactor: 6,   iterations: 14 },
  { moveClampFactor: 10,  iterations: 20 },
  { moveClampFactor: 15,  iterations: 24 },
  { moveClampFactor: 25,  iterations: 30 },
]

console.log('clampF  iters  |  cylRim: topR    shoulderR  filletDepth  |  cyl-open/nonManif/sliv  |  box edgeDrop  |  box-open/nonManif/sliv')
for (const cfg of configs) {
  const cylPos = makeCylinder(R, H, N, RINGS)
  const cylOut = taubinSmooth(geoFrom(cylPos), cfg.iterations, { sharpAngleDeg: 55, freezeMode: 'curved', moveClampFactor: cfg.moveClampFactor })
  const cp = cylOut.attributes.position.array
  const rim = rimShoulder(cp)
  const cylDef = countEdgeDefects({ attributes: { position: { array: cp } } })
  const cylSliv = countAreaSlivers({ attributes: { position: { array: cp } } })

  const boxPos = makeBox(20, 20, 10)
  const boxOut = taubinSmooth(geoFrom(boxPos), cfg.iterations, { sharpAngleDeg: 55, freezeMode: 'curved', moveClampFactor: cfg.moveClampFactor })
  const bp = boxOut.attributes.position.array
  const edgeDrop = boxEdgeCrispness(bp)
  const boxDef = countEdgeDefects({ attributes: { position: { array: bp } } })
  const boxSliv = countAreaSlivers({ attributes: { position: { array: bp } } })

  console.log(
    `${String(cfg.moveClampFactor).padStart(6)}  ${String(cfg.iterations).padStart(5)}  |  ` +
    `${rim.topR.toFixed(3).padStart(7)}  ${rim.shoulderR.toFixed(3).padStart(9)}  ${rim.filletDepth.toFixed(3).padStart(11)}  |  ` +
    `${cylDef.open}/${cylDef.nonManifold}/${cylSliv}`.padStart(10) + '  |  ' +
    `${edgeDrop.toFixed(3).padStart(12)}  |  ${boxDef.open}/${boxDef.nonManifold}/${boxSliv}`
  )
}
