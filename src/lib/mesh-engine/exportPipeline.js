/**
 * exportPipeline.js — the heavy mesh pipeline behind Export and Bake,
 * extracted from main.js so it can run EITHER on the main thread (fallback)
 * OR inside the export Web Worker (exportWorker.js). Pure data in/out: no
 * DOM, no i18n, no app state.
 *
 * Sequence (mirrors the old inline handleExport/bakeTextures exactly):
 *   subdivide → [regularize → re-subdivide] → displace
 *   → [decimate]                 (export mode only)
 *   → bottom clamp → smooth bottom
 *   → [resolveTJunctions]        (export mode, when decimation ran)
 *
 * @param {object} input
 *   positions     Float32Array  non-indexed triangle soup (xyz per vertex)
 *   faceWeights   Float32Array|null  per-vertex exclusion weights
 *   imageData     ImageData-like {data, width, height}
 *   imgWidth, imgHeight  texture dimensions
 *   settings      plain settings snapshot (structured-clone safe)
 *   bounds        {min,max,size,center} as {x,y,z} objects or Vector3s
 *   regularizeOpts  opts object for regularizeMesh
 *   mode          'export' | 'bake'
 * @param {function} [onEvent]  (stage, p, info) progress events; the caller
 *   maps stages to progress-bar fractions and translated labels.
 * @param {function} [shouldAbort]  checked between stages; true → return null.
 * @returns {Promise<null | {
 *   positions: Float32Array, normals: Float32Array|null,
 *   safetyCapHit: boolean, runDecimation: boolean, needsDecimation: boolean,
 *   faceParentId: Int32Array|null,   // bake mode only
 *   repairStats: object|null,        // export mode, when repair ran
 * }>}
 */

import { THREE } from './threeCompat.js';
import { QuantizedPointMap } from './meshIndex.js';
import { subdivide } from './subdivision.js';
import { regularizeMesh } from './regularize.js';
import { applyDisplacement } from './displacement.js';
import { decimate } from './decimation.js';
import { taubinSmooth } from './smoothing.js';
import { resolveTJunctions, countEdgeDefects, countAreaSlivers } from './meshRepair.js';

const yieldFrame = () => new Promise(r => setTimeout(r, 0));

// Revive a structured-cloned bounds object ({x,y,z} plain objects) into real
// Vector3s — displacement/mapping only read .x/.y/.z, but real vectors keep
// any future method use safe.
function reviveBounds(b) {
  const v = (o) => new THREE.Vector3(o.x, o.y, o.z);
  return { min: v(b.min), max: v(b.max), size: v(b.size), center: v(b.center) };
}

// Flat-bottom clamp (bottomAngleLimit > 0): any vertex that ended up below the
// original model's bottom layer gets snapped back up to that Z. Single pass
// with selective normal recomputation. (Verbatim from the old inline code.)
function clampBelowBottom(geometry, bottomZ) {
  const pa = geometry.attributes.position.array;
  const na = geometry.attributes.normal ? geometry.attributes.normal.array : new Float32Array(pa.length);

  for (let i = 0; i < pa.length; i += 9) {
    let dirty = false;
    if (pa[i+2] < bottomZ) { pa[i+2] = bottomZ; dirty = true; }
    if (pa[i+5] < bottomZ) { pa[i+5] = bottomZ; dirty = true; }
    if (pa[i+8] < bottomZ) { pa[i+8] = bottomZ; dirty = true; }

    if (dirty) {
      const ux = pa[i+3]-pa[i],   uy = pa[i+4]-pa[i+1], uz = pa[i+5]-pa[i+2];
      const vx = pa[i+6]-pa[i],   vy = pa[i+7]-pa[i+1], vz = pa[i+8]-pa[i+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
      na[i]   = na[i+3] = na[i+6] = nx/len;
      na[i+1] = na[i+4] = na[i+7] = ny/len;
      na[i+2] = na[i+5] = na[i+8] = nz/len;
    }
  }

  geometry.attributes.position.needsUpdate = true;
  if (!geometry.attributes.normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(na, 3));
  else geometry.attributes.normal.needsUpdate = true;
}

// Smooth Bottom: snap near-bottom vertices onto the bottom plane so the
// bed-contact surface comes out perfectly flat; recompute face normals on
// touched triangles.
//
// Fold gate (June 2026): the original unconditional band-snap flattened ANY
// geometry hovering within `tol` of the plane — notably the undersides of
// texture bumps near the base — folding it coplanar INTO the bottom face.
// Folded faces overlap the plate, so welded edges there pick up 4 incident
// faces: non-manifold edges and phantom "disconnected shells" on re-import
// (measured on the parking rack + dots: 40 nm edges / 39 shells, all at the
// bottom plane; 0 / 2 with the snap off). The snap is now per-position and
// gated like a regularize/decimation collapse: all copies of a welded
// position move together, and the move is REJECTED if any incident triangle
// would become degenerate or rotate its normal by more than ~75°. Genuine
// bed-contact slivers — the reason this feature exists — rotate by fractions
// of a degree and still snap; bump undersides would fold ~90° and stay put.
export function snapBottomToFlat(geometry, bottomZ, tol = 0.1) {
  const pa = geometry.attributes.position.array;
  const na = geometry.attributes.normal
    ? geometry.attributes.normal.array
    : new Float32Array(pa.length);

  const vertCount = pa.length / 3;
  const triCount  = vertCount / 3;

  // Weld positions (1e6 — the decimation grid; copies of one position are
  // bit-identical at this point) and build per-position incident corner lists.
  const weld = new QuantizedPointMap(1e6, Math.min(vertCount, 1 << 22));
  const vid = new Uint32Array(vertCount);
  let nUnique = 0;
  for (let i = 0; i < vertCount; i++) {
    const id = weld.getOrSet(pa[i*3], pa[i*3+1], pa[i*3+2], nUnique);
    if (weld.inserted) nUnique++;
    vid[i] = id;
  }
  const start = new Uint32Array(nUnique + 1);
  for (let i = 0; i < vertCount; i++) start[vid[i] + 1]++;
  for (let id = 0; id < nUnique; id++) start[id + 1] += start[id];
  const inc = new Uint32Array(vertCount);
  const cursor = new Uint32Array(nUnique);
  for (let i = 0; i < vertCount; i++) inc[start[vid[i]] + cursor[vid[i]]++] = i;

  const FOLD_COS = Math.cos(75 * Math.PI / 180);
  const dirtyTri = new Uint8Array(triCount);
  const _zs = new Float64Array(3);

  for (let id = 0; id < nUnique; id++) {
    const first = inc[start[id]];
    const z = pa[first * 3 + 2];
    if (z === bottomZ || Math.abs(z - bottomZ) > tol) continue;

    // Gate: simulate moving this position to the plane; every incident
    // triangle must keep positive area and not fold (normal rotation ≤ ~75°).
    let ok = true;
    for (let k = start[id]; k < start[id + 1] && ok; k++) {
      const t = (inc[k] / 3) | 0;
      const b = t * 9;
      const c0 = t * 3;
      // Post-move z per corner: corners welded to this id land on the plane.
      for (let v = 0; v < 3; v++) _zs[v] = vid[c0 + v] === id ? bottomZ : pa[b + v * 3 + 2];

      const oux = pa[b+3]-pa[b], ouy = pa[b+4]-pa[b+1], ouz = pa[b+5]-pa[b+2];
      const ovx = pa[b+6]-pa[b], ovy = pa[b+7]-pa[b+1], ovz = pa[b+8]-pa[b+2];
      const onx = ouy*ovz - ouz*ovy, ony = ouz*ovx - oux*ovz, onz = oux*ovy - ouy*ovx;

      const nuz = _zs[1] - _zs[0], nvz = _zs[2] - _zs[0];
      const nnx = ouy*nvz - nuz*ovy, nny = nuz*ovx - oux*nvz, nnz = oux*ovy - ouy*ovx;

      const o2 = onx*onx + ony*ony + onz*onz;
      const n2 = nnx*nnx + nny*nny + nnz*nnz;
      if (n2 < 1e-20) { ok = false; break; }      // would collapse to zero area
      if (o2 < 1e-20) continue;                    // already degenerate — can't judge rotation
      const dot = onx*nnx + ony*nny + onz*nnz;
      if (dot < 0 || dot * dot < FOLD_COS * FOLD_COS * o2 * n2) ok = false; // would fold
    }
    if (!ok) continue;

    // Apply: snap all copies of this position; mark incident triangles dirty.
    for (let k = start[id]; k < start[id + 1]; k++) {
      pa[inc[k] * 3 + 2] = bottomZ;
      dirtyTri[(inc[k] / 3) | 0] = 1;
    }
  }

  // Recompute face normals on touched triangles.
  let dirtyTris = 0;
  for (let t = 0; t < triCount; t++) {
    if (!dirtyTri[t]) continue;
    dirtyTris++;
    const i = t * 9;
    const ux = pa[i+3]-pa[i],   uy = pa[i+4]-pa[i+1], uz = pa[i+5]-pa[i+2];
    const vx = pa[i+6]-pa[i],   vy = pa[i+7]-pa[i+1], vz = pa[i+8]-pa[i+2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
    na[i]   = na[i+3] = na[i+6] = nx/len;
    na[i+1] = na[i+4] = na[i+7] = ny/len;
    na[i+2] = na[i+5] = na[i+8] = nz/len;
  }

  if (dirtyTris > 0) {
    geometry.attributes.position.needsUpdate = true;
    if (!geometry.attributes.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(na, 3));
    } else {
      geometry.attributes.normal.needsUpdate = true;
    }
  }
  return dirtyTris;
}

export async function runExportPipeline(input, onEvent = () => {}, shouldAbort = () => false) {
  const { settings, regularizeOpts } = input;
  const mode = input.mode === 'bake' ? 'bake' : 'export';
  const bounds = reviveBounds(input.bounds);
  const layers = mode === 'export' && input.layers && input.layers.length > 0 ? input.layers : null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(input.positions, 3));

  // Hoist intermediates so the finally block can always dispose them.
  let subdivided    = null;
  let displaced     = null;
  let finalGeometry = null;
  let done          = false;

  try {
    onEvent('subdivide1', 0);
    await yieldFrame();
    if (shouldAbort()) return null;

    let safetyCapHit, faceParentId;
    ({ geometry: subdivided, safetyCapHit, faceParentId } = await subdivide(
      geometry, settings.refineLength,
      (p, triCount, longestEdge) => onEvent('subdivide1', p, { triCount, longestEdge }),
      input.faceWeights || null
    ));
    if (shouldAbort()) return null;

    // Regularize sub-slivers, then re-subdivide stretched edges. Skipped when
    // the Advanced toggle is off. Bake mode always needed the composed parent
    // map; export mode now also needs it when baking multiple pattern layers
    // (each layer's post-subdivision mask is derived from parent ancestry),
    // so it's composed unconditionally — cheap relative to the rest of the pass.
    if (settings.regularizeEnabled) {
      onEvent('regularize', 0);
      await yieldFrame();
      const reg = regularizeMesh(subdivided, faceParentId, settings.refineLength, regularizeOpts);
      subdivided.dispose();
      const exclAttr = reg.geometry.attributes.excludeWeight;
      const secondPassWeights = exclAttr ? exclAttr.array : null;
      const { geometry: resub, faceParentId: resubParents } = await subdivide(
        reg.geometry, settings.refineLength * settings.regularizeSecondPassMul,
        (p, triCount, longestEdge) => onEvent('subdivide2', p, { triCount, longestEdge }),
        secondPassWeights, { fast: false }
      );
      reg.geometry.dispose();
      const composed = new Int32Array(resubParents.length);
      for (let i = 0; i < resubParents.length; i++) {
        composed[i] = reg.faceParentId[resubParents[i]];
      }
      faceParentId = composed;
      subdivided = resub;
    }
    if (shouldAbort()) return null;

    const subTriCount = subdivided.attributes.position.count / 3;
    onEvent('displace', 0, { triCount: subTriCount });
    await yieldFrame();

    if (layers) {
      // Multi-pattern export: one masked displacement pass per region,
      // sequentially, on the same evolving geometry. applyDisplacement
      // preserves triangle order/count (it repositions vertices in place,
      // never re-triangulates), so faceParentId — computed once above —
      // stays valid to re-derive each layer's own mask after prior passes.
      let current = subdivided;
      subdivided = null;
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const layerWeights = new Float32Array(subTriCount * 3);
        for (let t = 0; t < subTriCount; t++) {
          const included = layer.triangleSet[faceParentId[t]] === 1;
          const w = included ? 0 : 1;
          const o = t * 3;
          layerWeights[o] = w; layerWeights[o + 1] = w; layerWeights[o + 2] = w;
        }
        current.setAttribute('excludeWeight', new THREE.Float32BufferAttribute(layerWeights, 1));
        const layerBounds = layer.bounds ? reviveBounds(layer.bounds) : bounds;
        const next = applyDisplacement(
          current,
          layer.imageData,
          layer.imgWidth,
          layer.imgHeight,
          layer.settings,
          layerBounds,
          (p) => onEvent('displace', (li + p) / layers.length, { triCount: subTriCount })
        );
        current.dispose();
        current = next;
        if (shouldAbort()) { current.dispose(); return null; }
      }
      displaced = current;
    } else {
      displaced = applyDisplacement(
        subdivided,
        input.imageData,
        input.imgWidth,
        input.imgHeight,
        settings,
        bounds,
        (p) => onEvent('displace', p, { triCount: subTriCount })
      );
      // Free subdivided geometry — displacement created a separate copy.
      subdivided.dispose();
      subdivided = null;
    }
    if (shouldAbort()) return null;

    const dispTriCount = displaced.attributes.position.count / 3;
    const needsDecimation = dispTriCount > settings.maxTriangles;
    finalGeometry = displaced;

    // Decimation runs only in export mode (bake keeps the parent-face map,
    // which decimate drops): when over the target OR when flat-face harvesting
    // alone is wanted.
    const runDecimation = mode === 'export' && (needsDecimation || settings.harvestFlatFaces);
    if (runDecimation) {
      onEvent('decimate', 0, { from: dispTriCount, needsDecimation });
      await yieldFrame();
      finalGeometry = await decimate(
        displaced,
        settings.maxTriangles,
        (p) => onEvent('decimate', p, { from: dispTriCount, needsDecimation }),
        settings.harvestFlatFaces,
        settings.harvestTol
      );
      // Free pre-decimation geometry — decimate created a separate copy.
      displaced.dispose();
      displaced = null;
      if (shouldAbort()) return null;
    }

    // Finishing tail (bottom clamp → smooth bottom → T-junction repair) plus
    // the print-invariant measurement, factored so it can run on either the
    // smoothed or the un-smoothed geometry (see the smoothing fallback below).
    // Consumes `geo` (mutates in place / disposes it when repair replaces it)
    // and returns the finished geometry + its defect counts.
    const finishTail = (geo) => {
      if (settings.bottomAngleLimit > 0) clampBelowBottom(geo, bounds.min.z);
      if (settings.smoothBottom) snapBottomToFlat(geo, bounds.min.z, 0.1);
      let stats = null;
      if (runDecimation) {
        const beforeSlivers = countAreaSlivers(geo);
        const repaired = resolveTJunctions(geo);
        geo.dispose();
        geo = repaired;
        const after = countEdgeDefects(geo);
        stats = { beforeSlivers, open: after.open, nonManifold: after.nonManifold, slivers: countAreaSlivers(geo), tris: after.tris };
      }
      const inv = countEdgeDefects(geo);
      const slivers = countAreaSlivers(geo);
      if (!stats) stats = { beforeSlivers: slivers, open: inv.open, nonManifold: inv.nonManifold, slivers, tris: inv.tris };
      const clean = inv.open === 0 && inv.nonManifold === 0 && slivers === 0;
      return { geo, stats, clean, inv, slivers };
    };

    let repairStats = null;

    // Taubin smoothing — softens hard facet ridges/step-edges and rounds curved
    // feature edges (freezeMode:'curved' keeps straight edges crisp, rounds
    // curved rims). It's a QUALITY enhancement: if on some (pathological) input
    // it would break the print invariant (0 open / 0 non-manifold / 0 slivers),
    // we DISCARD the smoothed result and export the un-smoothed geometry instead
    // — watertightness is non-negotiable, softness is best-effort. Runs before
    // the bottom clamp/snap so the bed-contact plane stays flat.
    if (settings.smoothingIterations > 0) {
      onEvent('smooth', 0);
      await yieldFrame();
      // Pristine copy of the pre-smoothing (post-decimation) mesh, kept for the
      // fallback. finishTail is watertight-by-construction on this input.
      const preSmooth = finalGeometry.clone();
      // moveClampFactor bounds how far a curved-crease vertex may round away
      // from its original position (as a multiple of local edge length) — it's
      // the dominant lever on fillet SIZE, independent of iteration count.
      // Scale it with the smoothness level (via iteration count, 0..~14) so
      // low smoothness stays a light touch and high smoothness produces a
      // deep, clearly-soft rounded fillet on curved edges.
      const MAX_SMOOTHING_ITERATIONS_REF = 14;
      const smoothT = Math.min(1, settings.smoothingIterations / MAX_SMOOTHING_ITERATIONS_REF);
      const moveClampFactor = 2 + smoothT * 7; // 2 (light) .. 9 (deep fillet)
      const smoothed = taubinSmooth(
        finalGeometry,
        settings.smoothingIterations,
        { sharpAngleDeg: 55, freezeMode: 'curved', moveClampFactor },
        (p) => onEvent('smooth', p),
      );
      if (smoothed !== finalGeometry) {
        if (displaced === finalGeometry) displaced = null; // may alias (no decimation)
        finalGeometry.dispose();
        finalGeometry = smoothed;
      }
      if (shouldAbort()) { preSmooth.dispose(); return null; }

      onEvent('repair', 0);
      await yieldFrame();
      const smoothedResult = finishTail(finalGeometry);
      if (smoothedResult.clean) {
        finalGeometry = smoothedResult.geo;
        repairStats = smoothedResult.stats;
        preSmooth.dispose();
      } else {
        // Smoothing broke the invariant — fall back to the un-smoothed mesh.
        console.warn(
          `[export] smoothing produced a non-print-safe mesh (open=${smoothedResult.inv.open} ` +
          `nonManifold=${smoothedResult.inv.nonManifold} slivers=${smoothedResult.slivers}); ` +
          `exporting the un-smoothed geometry for this mesh to guarantee watertightness.`,
        );
        smoothedResult.geo.dispose();
        const fallback = finishTail(preSmooth);
        finalGeometry = fallback.geo;
        repairStats = { ...fallback.stats, smoothingFellBack: true };
      }
      if (shouldAbort()) return null;
    } else {
      onEvent('repair', 0);
      await yieldFrame();
      const result = finishTail(finalGeometry);
      finalGeometry = result.geo;
      repairStats = result.stats;
      if (shouldAbort()) return null;
    }

    // ── Print invariant (ALWAYS) ─────────────────────────────────────────────
    // Final guarantee on the geometry actually being returned. After the
    // fallback above this should never fire; if it does, something upstream of
    // smoothing (subdivision/displace/decimate/repair) produced a broken mesh.
    {
      const inv = countEdgeDefects(finalGeometry);
      const invSlivers = countAreaSlivers(finalGeometry);
      if (inv.open > 0 || inv.nonManifold > 0 || invSlivers > 0) {
        console.error(
          `[export invariant VIOLATED] open=${inv.open} nonManifold=${inv.nonManifold} ` +
          `slivers=${invSlivers} tris=${inv.tris} — exported mesh is NOT print-safe. ` +
          `This is a bug in the export pipeline (subdivision / displace / decimate / repair).`,
        );
      }
    }

    done = true;
    return {
      positions: finalGeometry.attributes.position.array,
      normals: finalGeometry.attributes.normal ? finalGeometry.attributes.normal.array : null,
      safetyCapHit,
      runDecimation,
      needsDecimation,
      faceParentId: mode === 'bake' ? faceParentId : null,
      repairStats,
    };
  } finally {
    // Dispose intermediates regardless of success, failure, or abort.
    // finalGeometry may alias displaced (no decimation) — avoid double-dispose.
    if (subdivided) subdivided.dispose();
    if (displaced && displaced !== subdivided) displaced.dispose();
    if (!done && finalGeometry && finalGeometry !== displaced && finalGeometry !== subdivided) {
      finalGeometry.dispose();
    }
  }
}
