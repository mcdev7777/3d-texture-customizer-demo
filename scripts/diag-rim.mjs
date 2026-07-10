/**
 * Diagnostic: quantify curved-rim softness. Bakes a displaced cylinder and
 * measures the radial roughness of its top rim loop (the "comb spikes" the
 * user sees on curved circular edges) at several smoothness values.
 *
 * Rim roughness = std-dev of per-vertex radius among vertices near the top
 * rim, in mm. Lower = smoother curved edge. If smoothness has little effect,
 * the crease-loop relax isn't reaching these vertices.
 */
import { runExportPipeline } from '../src/lib/mesh-engine/exportPipeline.js'

const R = 12, H = 8, N = 64
function makeCylinder(r, h, n) {
  const hz = h / 2
  const pos = []
  const tri = (...v) => pos.push(...v)
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r
    tri(x0, y0, -hz, x1, y1, -hz, x1, y1, hz)
    tri(x0, y0, -hz, x1, y1, hz, x0, y0, hz)
    tri(0, 0, hz, x0, y0, hz, x1, y1, hz)
    tri(0, 0, -hz, x1, y1, -hz, x0, y0, -hz)
  }
  return new Float32Array(pos)
}
function boundsOf(p) {
  let mnx=1/0,mny=1/0,mnz=1/0,mxx=-1/0,mxy=-1/0,mxz=-1/0
  for (let i=0;i<p.length;i+=3){const x=p[i],y=p[i+1],z=p[i+2]
    if(x<mnx)mnx=x;if(x>mxx)mxx=x;if(y<mny)mny=y;if(y>mxy)mxy=y;if(z<mnz)mnz=z;if(z>mxz)mxz=z}
  const mk=(x,y,z)=>({x,y,z})
  return {min:mk(mnx,mny,mnz),max:mk(mxx,mxy,mxz),size:mk(mxx-mnx,mxy-mny,mxz-mnz),center:mk((mnx+mxx)/2,(mny+mxy)/2,(mnz+mxz)/2)}
}
// High-frequency per-texel noise → fine radial "comb" spikes on the rim,
// matching the user's artifact (unlike a coarse checkerboard's smooth plateaus).
function heightmap(size) {
  const data = new Uint8ClampedArray(size*size*4)
  let seed = 12345
  const rnd = () => { seed = (seed*1103515245+12345) & 0x7fffffff; return seed/0x7fffffff }
  for (let i=0;i<size*size;i++){
    const g = rnd()*255 | 0
    data[i*4]=data[i*4+1]=data[i*4+2]=g; data[i*4+3]=255
  }
  return {data,width:size,height:size}
}
const settings = (it) => ({
  mappingMode:5, scaleU:1, scaleV:1, amplitude:1.2, offsetU:0, offsetV:0, rotation:0,
  invertDisplacement:false, symmetricDisplacement:false, mappingBlend:1, seamBandWidth:0.5,
  blendNormalSmoothing:16, refineLength:0.8, maxTriangles:120000, bottomAngleLimit:5, topAngleLimit:0,
  smoothBottom:true, harvestFlatFaces:true, harvestTol:0.005, regularizeEnabled:true,
  regularizeSecondPassMul:1.1, boundaryFalloff:0, noDownwardZ:false, smoothingIterations:it,
})
const regularizeOpts = {aspectThreshold:5,slack:3,aggressiveSlack:8,extremeSliverAspect:8,
  maxNormalDeltaCos:Math.cos(15*Math.PI/180),aggressiveNormalDeltaCos:Math.cos(25*Math.PI/180)}
const MAX_IT=14, s2it=(v)=>Math.round(v/100*MAX_IT)

async function bake(it) {
  const positions = makeCylinder(R,H,N)
  const imageData = heightmap(256)
  const r = await runExportPipeline({positions,faceWeights:null,imageData,imgWidth:256,imgHeight:256,
    settings:settings(it),bounds:boundsOf(positions),regularizeOpts,mode:'export'},()=>{},()=>false)
  return r.positions
}

// Rim ring = the OUTERMOST vertices at the TOP: within 0.35mm of max-z and
// radius within 0.8mm of the max radius seen there. Radial std of that ring is
// the comb-spike magnitude on the curved edge.
function rimRoughness(pos) {
  let maxZ = -1/0
  for (let i=0;i<pos.length;i+=3) if (pos[i+2] > maxZ) maxZ = pos[i+2]
  let maxRad = 0
  for (let i=0;i<pos.length;i+=3){
    if (pos[i+2] < maxZ-0.35) continue
    const rad = Math.hypot(pos[i],pos[i+1]); if (rad > maxRad) maxRad = rad
  }
  const radii = []
  for (let i=0;i<pos.length;i+=3){
    if (pos[i+2] < maxZ-0.35) continue
    const rad = Math.hypot(pos[i],pos[i+1])
    if (rad < maxRad-0.8) continue
    radii.push(rad)
  }
  const m = radii.reduce((a,b)=>a+b,0)/radii.length
  const v = radii.reduce((a,b)=>a+(b-m)**2,0)/radii.length
  return {count:radii.length, meanR:m, std:Math.sqrt(v), max:Math.max(...radii), min:Math.min(...radii)}
}

console.log('smooth iters  rimVerts  meanR    std(mm)   spread(mm)')
for (const s of [0,30,60,100]) {
  const it = s2it(s)
  const rr = rimRoughness(await bake(it))
  console.log(`${String(s).padStart(5)} ${String(it).padStart(5)}  ${String(rr.count).padStart(7)}  ${rr.meanR.toFixed(3)}  ${rr.std.toFixed(4)}   ${(rr.max-rr.min).toFixed(3)}`)
}
