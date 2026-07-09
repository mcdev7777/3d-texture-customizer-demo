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
 * @param {number}              [opts.sharpAngleDeg=35]  dihedral above which an edge counts as a crease
 * @param {boolean}             [opts.freezeCreases=true] freeze crease vertices (preserve hard edges); false rounds them into soft fillets
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
  // When false, manifold crease edges (>sharpAngle dihedral) are NOT frozen —
  // the general 3D Taubin pass is allowed to round them, softening curved
  // feature edges (circular hole rims) into fillets. Boundary/non-manifold
  // edges are always frozen regardless (they have no opposing face to average
  // against, and moving them opens the mesh). The fold-rejection guard bounds
  // how far any single edge can round per step, so hard corners still resist.
  const freezeCreases = opts.freezeCreases ?? true;

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
  // Up to 2 "crease neighbours" per vertex — the two vertices reached via a
  // crease/boundary edge, i.e. its neighbours along the crease LOOP (a
  // circular hole rim, a chamfer line). -1 = unset, -2 = more than 2 seen
  // (irregular junction — leave that vertex fully frozen, no tangential move).
  const creaseA = new Int32Array(nUnique).fill(-1);
  const creaseB = new Int32Array(nUnique).fill(-1);
  const addCreaseNeighbour = (id, other) => {
    if (creaseA[id] === -2) return;
    if (creaseA[id] === -1) { creaseA[id] = other; return; }
    if (creaseA[id] === other) return;
    if (creaseB[id] === -1) { creaseB[id] = other; return; }
    if (creaseB[id] === other) return;
    creaseA[id] = -2; creaseB[id] = -2; // irregular (>2 crease edges) — fully freeze
  };
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
        if (dot < sharpCos) {
          if (freezeCreases) { frozen[lo] = 1; frozen[hi] = 1; }
          addCreaseNeighbour(lo, hi); addCreaseNeighbour(hi, lo);
        }
      }
    }
    // Boundary / non-manifold edges (incidence ≠ 2) also freeze their ends.
    for (let id = 0; id < nEdges; id++) {
      if (edgeCount[id] !== 2) {
        const lo = edgeLo[id], hi = edgeHi[id];
        frozen[lo] = 1; frozen[hi] = 1;
        addCreaseNeighbour(lo, hi); addCreaseNeighbour(hi, lo);
      }
    }
  }

  // ── Per-triangle unique-vertex ids (for the fold-rejection guard) ────────
  const triV0 = new Int32Array(triCount);
  const triV1 = new Int32Array(triCount);
  const triV2 = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    triV0[t] = cornerVid[t * 3];
    triV1[t] = cornerVid[t * 3 + 1];
    triV2[t] = cornerVid[t * 3 + 2];
  }

  // ── CSR vertex → incident triangles (for the fold-rejection guard) ────────
  const triDeg = new Uint32Array(nUnique);
  for (let t = 0; t < triCount; t++) {
    triDeg[triV0[t]]++;
    if (triV1[t] !== triV0[t]) triDeg[triV1[t]]++;
    if (triV2[t] !== triV0[t] && triV2[t] !== triV1[t]) triDeg[triV2[t]]++;
  }
  const triCsr = new Uint32Array(nUnique + 1);
  for (let id = 0; id < nUnique; id++) triCsr[id + 1] = triCsr[id] + triDeg[id];
  const triList = new Uint32Array(triCsr[nUnique]);
  const triCursor = new Uint32Array(nUnique);
  for (let t = 0; t < triCount; t++) {
    const a = triV0[t], b = triV1[t], c = triV2[t];
    triList[triCsr[a] + triCursor[a]++] = t;
    if (b !== a) triList[triCsr[b] + triCursor[b]++] = t;
    if (c !== a && c !== b) triList[triCsr[c] + triCursor[c]++] = t;
  }

  // Reject a vertex move if any incident triangle would fold (normal rotates
  // more than ~70° vs. its pre-move direction) or collapse to zero area. This
  // is what prevents the "destroyed" torn band of inverted triangles at hard
  // model edges, where near-edge vertices are pulled past frozen edge vertices.
  const FOLD_COS = Math.cos(70 * Math.PI / 180);
  const moveWouldFold = (id, nx, ny, nz, X, Y, Z) => {
    const ox = X[id], oy = Y[id], oz = Z[id];
    for (let k = triCsr[id]; k < triCsr[id + 1]; k++) {
      const t = triList[k];
      const a = triV0[t], b = triV1[t], c = triV2[t];
      const ax = a === id ? ox : X[a], ay = a === id ? oy : Y[a], az = a === id ? oz : Z[a];
      const bx = b === id ? ox : X[b], by = b === id ? oy : Y[b], bz = b === id ? oz : Z[b];
      const cx = c === id ? ox : X[c], cy = c === id ? oy : Y[c], cz = c === id ? oz : Z[c];
      // current normal
      let ux = bx - ax, uy = by - ay, uz = bz - az;
      let vx = cx - ax, vy = cy - ay, vz = cz - az;
      const cnx = uy * vz - uz * vy, cny = uz * vx - ux * vz, cnz = ux * vy - uy * vx;
      const cl2 = cnx * cnx + cny * cny + cnz * cnz;
      // proposed normal: this vertex moved to (nx,ny,nz)
      const pax = a === id ? nx : ax, pay = a === id ? ny : ay, paz = a === id ? nz : az;
      const pbx = b === id ? nx : bx, pby = b === id ? ny : by, pbz = b === id ? nz : bz;
      const pcx = c === id ? nx : cx, pcy = c === id ? ny : cy, pcz = c === id ? nz : cz;
      ux = pbx - pax; uy = pby - pay; uz = pbz - paz;
      vx = pcx - pax; vy = pcy - pay; vz = pcz - paz;
      const pnx = uy * vz - uz * vy, pny = uz * vx - ux * vz, pnz = ux * vy - uy * vx;
      const pl2 = pnx * pnx + pny * pny + pnz * pnz;
      if (pl2 < 1e-20) return true;            // would collapse to zero area
      if (cl2 < 1e-20) continue;               // already degenerate — can't judge
      const dot = cnx * pnx + cny * pny + cnz * pnz;
      if (dot < 0 || dot * dot < FOLD_COS * FOLD_COS * cl2 * pl2) return true;
    }
    return false;
  };

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
      if (frozen[id]) {
        // Crease/boundary vertex (a circular hole rim, a chamfer line, a
        // model edge). Full 3D smoothing is disabled — that would melt the
        // sharp feature into the surrounding surface — but the vertex may
        // still be zigzagging along the crease LOOP itself (inherited from
        // the source tessellation / decimation), which is what shows up as a
        // jagged circular rim. When it has exactly two crease neighbours
        // (interior point of a clean loop), relax it toward their midpoint —
        // a 1D smoothing pass that slides it along the loop's tangent
        // direction, rounding the loop out without moving the feature off
        // the surface it's frozen to. Junctions (creaseA === -2) or loop
        // endpoints stay fully static.
        // Only relax on the POSITIVE (λ) pass. The Taubin μ (negative) pass
        // exists to cancel volumetric shrinkage of the 2D surface smoothing —
        // but on a 1D crease LOOP a negative-Laplacian step re-amplifies the
        // high-frequency radial spikes it's trying to remove (that's how Taubin
        // preserves detail). A circular rim should simply round toward a
        // smooth circle, so we run pure Laplacian here: skip the μ pass.
        if (factor > 0 && creaseA[id] >= 0 && creaseB[id] >= 0) {
          const na = creaseA[id], nb = creaseB[id];
          const mx = (curX[na] + curX[nb]) / 2;
          const my = (curY[na] + curY[nb]) / 2;
          const mz = (curZ[na] + curZ[nb]) / 2;
          const cx = curX[id] + factor * (mx - curX[id]);
          const cy = curY[id] + factor * (my - curY[id]);
          const cz = curZ[id] + factor * (mz - curZ[id]);
          if (!moveWouldFold(id, cx, cy, cz, curX, curY, curZ)) {
            nxtX[id] = cx; nxtY[id] = cy; nxtZ[id] = cz;
            continue;
          }
        }
        nxtX[id] = curX[id]; nxtY[id] = curY[id]; nxtZ[id] = curZ[id];
        continue;
      }
      if (e === s) {
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
      const cx = curX[id] + factor * dx;
      const cy = curY[id] + factor * dy;
      const cz = curZ[id] + factor * dz;
      // Skip the move if it would fold or collapse an incident triangle —
      // leaves that vertex where it is rather than tearing the surface.
      if (moveWouldFold(id, cx, cy, cz, curX, curY, curZ)) {
        nxtX[id] = curX[id]; nxtY[id] = curY[id]; nxtZ[id] = curZ[id];
      } else {
        nxtX[id] = cx; nxtY[id] = cy; nxtZ[id] = cz;
      }
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
