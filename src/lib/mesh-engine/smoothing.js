/**
 * Taubin (λ|μ) mesh smoothing on a non-indexed triangle soup.
 *
 * Shrink-free alternative to plain Laplacian smoothing: each iteration runs a
 * positive (λ) smoothing pass immediately followed by a negative (μ) inflation
 * pass. The two passes cancel low-frequency shrinkage, so curved/relief
 * surfaces soften ("soft, not tough" printed edges) without the whole model
 * deflating inward the way repeated Laplacian averaging would. Reference:
 * Taubin, "A signal processing approach to fair surface design" (1995).
 *
 * Sharp features are preserved the same way regularize.js preserves them:
 *   - Vertices on an edge whose two incident face normals diverge by more than
 *     `sharpAngleDeg` (a crease, a cube corner, a chamfer) are FROZEN — never
 *     moved — so intentional hard edges stay crisp while only smoothly-curved
 *     regions get softened.
 *   - Boundary vertices (on an edge with fewer than 2 incident faces) are
 *     frozen too, so open borders don't creep inward.
 *
 * The input is the export pipeline's non-indexed soup: every triangle owns its
 * own copy of each vertex. All copies of one welded position share a single
 * smoothed result, so the output stays watertight.
 *
 * @param {THREE.BufferGeometry} geometry   non-indexed (xyz per corner)
 * @param {number}               iterations number of λ/μ pairs (≤0 → no-op, returns input)
 * @param {object}              [opts]
 * @param {number}              [opts.lambda=0.5]        positive smoothing factor
 * @param {number}              [opts.mu=-0.53]          negative inflation factor (|mu| slightly > lambda)
 * @param {number}              [opts.sharpAngleDeg=35]  dihedral above which an edge freezes its endpoints
 * @param {function}            [onProgress]             callback(fraction 0–1)
 * @returns {THREE.BufferGeometry} new non-indexed geometry with per-face normals recomputed
 */

import { THREE } from './threeCompat.js';
import { QuantizedPointMap } from './meshIndex.js';

// Match subdivision.js / displacement.js: 10 µm dedup cells so watertight
// copies of one position weld together but distinct fillet vertices don't.
const QUANTISE = 1e5;

export function taubinSmooth(geometry, iterations, opts = {}, onProgress) {
  if (!iterations || iterations <= 0) return geometry;

  const lambda = opts.lambda ?? 0.5;
  const mu = opts.mu ?? -0.53;
  const sharpCos = Math.cos((opts.sharpAngleDeg ?? 35) * Math.PI / 180);

  const pa = geometry.attributes.position.array;
  const cornerCount = pa.length / 3;
  const triCount = cornerCount / 3;
  if (triCount === 0) return geometry;

  // ── Weld corners → unique positions ──────────────────────────────────────
  const map = new QuantizedPointMap(QUANTISE, Math.min(cornerCount, 1 << 22));
  const cornerVid = new Uint32Array(cornerCount);
  const posX = new Float64Array(cornerCount);
  const posY = new Float64Array(cornerCount);
  const posZ = new Float64Array(cornerCount);
  let nUnique = 0;
  for (let i = 0; i < cornerCount; i++) {
    const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
    const id = map.getOrSet(x, y, z, nUnique);
    if (map.inserted) {
      posX[nUnique] = x; posY[nUnique] = y; posZ[nUnique] = z;
      nUnique++;
    }
    cornerVid[i] = id;
  }

  // ── Per-face unit normals (for the sharp-edge freeze test) ───────────────
  const fnX = new Float64Array(triCount);
  const fnY = new Float64Array(triCount);
  const fnZ = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = cornerVid[t * 3], b = cornerVid[t * 3 + 1], c = cornerVid[t * 3 + 2];
    const e1x = posX[b] - posX[a], e1y = posY[b] - posY[a], e1z = posZ[b] - posZ[a];
    const e2x = posX[c] - posX[a], e2y = posY[c] - posY[a], e2z = posZ[c] - posZ[a];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    fnX[t] = nx / len; fnY[t] = ny / len; fnZ[t] = nz / len;
  }

  // ── Edge scan: count incidence + detect creases, freeze their endpoints ──
  // Integer-keyed map over (lo, hi) unique-vertex pairs → edge id (quant 1,
  // as regularize.js does). Track incidence count and the first incident face
  // so the second occurrence can compare normals.
  const maxEdges = triCount * 3;
  const edgeMap = new QuantizedPointMap(1, Math.min(maxEdges, 1 << 22));
  const edgeCount = new Uint8Array(maxEdges);
  const edgeFace0 = new Int32Array(maxEdges);
  const edgeLo = new Int32Array(maxEdges);
  const edgeHi = new Int32Array(maxEdges);
  let nEdges = 0;
  for (let t = 0; t < triCount; t++) {
    const a = cornerVid[t * 3], b = cornerVid[t * 3 + 1], c = cornerVid[t * 3 + 2];
    for (let e = 0; e < 3; e++) {
      const u = e === 0 ? a : e === 1 ? b : c;
      const v = e === 0 ? b : e === 1 ? c : a;
      const lo = u < v ? u : v, hi = u < v ? v : u;
      const id = edgeMap.getOrSet(lo, hi, 0, nEdges);
      if (edgeMap.inserted) {
        edgeLo[nEdges] = lo; edgeHi[nEdges] = hi;
        edgeFace0[nEdges] = t;
        edgeCount[nEdges] = 1;
        nEdges++;
      } else if (edgeCount[id] < 255) {
        edgeCount[id]++;
      }
    }
  }

  const frozen = new Uint8Array(nUnique);
  // Second pass over triangles to find, for each edge, its two faces' normals.
  // We already stored face0; re-scan and, when we meet an edge a second time,
  // compare against face0. (A manifold edge has exactly 2 faces.)
  {
    const secondFaceSeen = new Uint8Array(nEdges);
    for (let t = 0; t < triCount; t++) {
      const a = cornerVid[t * 3], b = cornerVid[t * 3 + 1], c = cornerVid[t * 3 + 2];
      for (let e = 0; e < 3; e++) {
        const u = e === 0 ? a : e === 1 ? b : c;
        const v = e === 0 ? b : e === 1 ? c : a;
        const lo = u < v ? u : v, hi = u < v ? v : u;
        const id = edgeMap.getOrSet(lo, hi, 0, -1); // lookup only; never inserts
        const f0 = edgeFace0[id];
        if (f0 === t || secondFaceSeen[id]) continue;
        secondFaceSeen[id] = 1;
        const dot = fnX[f0] * fnX[t] + fnY[f0] * fnY[t] + fnZ[f0] * fnZ[t];
        if (dot < sharpCos) { frozen[lo] = 1; frozen[hi] = 1; }
      }
    }
    // Boundary / non-manifold edges (incidence ≠ 2) also freeze their ends.
    for (let id = 0; id < nEdges; id++) {
      if (edgeCount[id] !== 2) { frozen[edgeLo[id]] = 1; frozen[edgeHi[id]] = 1; }
    }
  }

  // ── Build CSR neighbour adjacency over unique vertices (multigraph) ───────
  const degree = new Uint32Array(nUnique);
  for (let t = 0; t < triCount; t++) {
    const a = cornerVid[t * 3], b = cornerVid[t * 3 + 1], c = cornerVid[t * 3 + 2];
    if (a !== b) { degree[a]++; degree[b]++; }
    if (b !== c) { degree[b]++; degree[c]++; }
    if (c !== a) { degree[c]++; degree[a]++; }
  }
  const csrStart = new Uint32Array(nUnique + 1);
  for (let id = 0; id < nUnique; id++) csrStart[id + 1] = csrStart[id] + degree[id];
  const totalEdges = csrStart[nUnique];
  const neighbors = new Uint32Array(totalEdges);
  const cursor = new Uint32Array(nUnique);
  for (let t = 0; t < triCount; t++) {
    const a = cornerVid[t * 3], b = cornerVid[t * 3 + 1], c = cornerVid[t * 3 + 2];
    if (a !== b) { neighbors[csrStart[a] + cursor[a]++] = b; neighbors[csrStart[b] + cursor[b]++] = a; }
    if (b !== c) { neighbors[csrStart[b] + cursor[b]++] = c; neighbors[csrStart[c] + cursor[c]++] = b; }
    if (c !== a) { neighbors[csrStart[c] + cursor[c]++] = a; neighbors[csrStart[a] + cursor[a]++] = c; }
  }

  // ── Taubin iterations ────────────────────────────────────────────────────
  let curX = posX, curY = posY, curZ = posZ;
  let nxtX = new Float64Array(nUnique);
  let nxtY = new Float64Array(nUnique);
  let nxtZ = new Float64Array(nUnique);

  const applyPass = (factor) => {
    for (let id = 0; id < nUnique; id++) {
      const s = csrStart[id], e = csrStart[id + 1];
      if (frozen[id] || e === s) {
        nxtX[id] = curX[id]; nxtY[id] = curY[id]; nxtZ[id] = curZ[id];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let k = s; k < e; k++) {
        const nb = neighbors[k];
        sx += curX[nb]; sy += curY[nb]; sz += curZ[nb];
      }
      const inv = 1 / (e - s);
      const dx = sx * inv - curX[id];
      const dy = sy * inv - curY[id];
      const dz = sz * inv - curZ[id];
      nxtX[id] = curX[id] + factor * dx;
      nxtY[id] = curY[id] + factor * dy;
      nxtZ[id] = curZ[id] + factor * dz;
    }
    const tx = curX, ty = curY, tz = curZ;
    curX = nxtX; curY = nxtY; curZ = nxtZ;
    nxtX = tx; nxtY = ty; nxtZ = tz;
  };

  for (let iter = 0; iter < iterations; iter++) {
    applyPass(lambda);
    applyPass(mu);
    if (onProgress) onProgress((iter + 1) / iterations);
  }

  // ── Write smoothed unique positions back to every corner copy ────────────
  const outPos = new Float32Array(cornerCount * 3);
  for (let i = 0; i < cornerCount; i++) {
    const id = cornerVid[i];
    outPos[i * 3] = curX[id];
    outPos[i * 3 + 1] = curY[id];
    outPos[i * 3 + 2] = curZ[id];
  }

  // ── Recompute per-face normals from the smoothed positions ───────────────
  const outNrm = new Float32Array(cornerCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ax = outPos[i], ay = outPos[i + 1], az = outPos[i + 2];
    const bx = outPos[i + 3], by = outPos[i + 4], bz = outPos[i + 5];
    const cx = outPos[i + 6], cy = outPos[i + 7], cz = outPos[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const inx = nx / len, iny = ny / len, inz = nz / len;
    outNrm[i] = outNrm[i + 3] = outNrm[i + 6] = inx;
    outNrm[i + 1] = outNrm[i + 4] = outNrm[i + 7] = iny;
    outNrm[i + 2] = outNrm[i + 5] = outNrm[i + 8] = inz;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  return out;
}
