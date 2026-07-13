import { DataTexture, DoubleSide, RGBAFormat, RepeatWrapping, Vector2, Vector3, type Material } from 'three'
import type { EngineBounds, EngineLayerSettings } from '../mesh-engine/exportPipeline'

/**
 * GPU-side "fast 3D preview" — the height half of BumpMesh's preview strategy,
 * but injected into the mesh's OWN material instead of a bespoke shader.
 *
 * Rather than run the full CPU mesh pipeline (subdivide → displace → decimate →
 * repair) for every pattern tweak, the pattern is projected and displaced/
 * bump-shaded entirely on the GPU, so the preview updates in one frame the way
 * BumpMesh's does.
 *
 * Crucially, the surface material is a *clone of the model's own material*,
 * patched via `onBeforeCompile`: the vertex stage moves each vertex out along
 * its normal by the sampled pattern height, and the fragment stage perturbs the
 * lighting normal for sub-vertex relief. Nothing touches the base colour, map,
 * roughness, metalness, or the scene's lighting — so the patterned surface
 * keeps the exact original appearance and only gains height. (An earlier custom
 * self-lit shader shifted colours toward pink/white; this avoids that entirely.)
 *
 * The injected GLSL UV math is kept in lock-step with mesh-engine/mapping.js
 * (modes 5 triplanar, 6 cubic, 3 cylindrical incl. the arbitrary-axis cylinder
 * frame) so the preview projects a pattern the same way the export bake does.
 */

const MODE_CYLINDRICAL = 3

// Shared uniform declarations + UV/height math, injected into both stages.
const heightGLSL = /* glsl */ `
  uniform sampler2D ppDisplacementMap;
  uniform int   ppMappingMode;
  uniform vec2  ppScaleUV;
  uniform float ppAmplitude;
  uniform vec2  ppOffsetUV;
  uniform float ppRotation;
  uniform vec3  ppBoundsMin;
  uniform vec3  ppBoundsSize;
  uniform vec3  ppBoundsCenter;
  uniform vec2  ppTextureAspect;
  uniform float ppMappingBlend;
  uniform float ppSeamBandWidth;
  uniform float ppCapAngle;
  uniform int   ppSymmetric;
  uniform int   ppUseDisplacement;
  uniform int   ppHasCylFrame;
  uniform vec3  ppCylAxis;
  uniform vec3  ppCylRight;
  uniform vec3  ppCylUp;
  uniform vec3  ppCylCenter;
  uniform float ppCylRadius;

  const float PP_PI     = 3.14159265358979;
  const float PP_TWO_PI = 6.28318530717959;
  const float PP_EPS    = 1e-4;

  int ppDominantAxis(vec3 n) {
    vec3 a = abs(n);
    if (a.x >= a.y - PP_EPS && a.x >= a.z - PP_EPS) return 0;
    if (a.y >= a.z - PP_EPS) return 1;
    return 2;
  }

  vec3 ppCubicWeights(vec3 n) {
    vec3 a = abs(n);
    int axis = ppDominantAxis(n);
    float primary = axis == 0 ? a.x : axis == 1 ? a.y : a.z;
    float secondary = axis == 0 ? max(a.y, a.z) : axis == 1 ? max(a.x, a.z) : max(a.x, a.y);
    vec3 oneHot = axis == 0 ? vec3(1.0, 0.0, 0.0) : axis == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    if (ppMappingBlend < 0.001) return oneHot;
    float seamWidth = max(ppSeamBandWidth, PP_EPS * 2.0);
    float seamMixRaw = 1.0 - clamp((primary - secondary) / seamWidth, 0.0, 1.0);
    float seamMix = ppMappingBlend * seamMixRaw * seamMixRaw * (3.0 - 2.0 * seamMixRaw);
    if (seamMix <= 0.001) return oneHot;
    float power = 1.0 + (1.0 - seamMix) * 11.0;
    vec3 soft = pow(a, vec3(power));
    soft /= dot(soft, vec3(1.0)) + 1e-6;
    vec3 blended = mix(oneHot, soft, seamMix);
    return blended / (dot(blended, vec3(1.0)) + 1e-6);
  }

  float ppSample(vec2 rawUV) {
    vec2 uv = (rawUV * ppTextureAspect) / ppScaleUV + ppOffsetUV;
    float c = cos(ppRotation); float s = sin(ppRotation);
    uv -= 0.5;
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
    uv += 0.5;
    return texture2D(ppDisplacementMap, uv).r;
  }

  float ppHeight(vec3 pos, vec3 projN, vec3 blendN) {
    float md = max(max(ppBoundsSize.x, max(ppBoundsSize.y, ppBoundsSize.z)), 1e-6);

    if (ppMappingMode == 3) {
      float r = max(ppCylRadius, 1e-4);
      float C = PP_TWO_PI * r;
      float uRaw, vSide, capX, capY, absAxis;
      if (ppHasCylFrame == 1) {
        vec3 d = pos - ppCylCenter;
        float h = dot(d, ppCylAxis);
        capX = dot(d, ppCylRight);
        capY = dot(d, ppCylUp);
        uRaw = atan(capY, capX) / PP_TWO_PI + 0.5;
        vSide = h / C;
        absAxis = abs(dot(blendN, ppCylAxis));
      } else {
        capX = pos.x - ppCylCenter.x;
        capY = pos.y - ppCylCenter.y;
        uRaw = atan(capY, capX) / PP_TWO_PI + 0.5;
        vSide = (pos.z - ppBoundsMin.z) / C;
        absAxis = abs(blendN.z);
      }
      float seamBand = ppSeamBandWidth * 0.1;
      float seamDist = min(uRaw, 1.0 - uRaw);
      float hSide;
      if (seamBand > 0.001 && seamDist < seamBand) {
        float dd = uRaw < 0.5 ? uRaw : uRaw - 1.0;
        float t = smoothstep(0.0, 1.0, (dd + seamBand) / (2.0 * seamBand));
        hSide = mix(ppSample(vec2(1.0 + dd, vSide)), ppSample(vec2(dd, vSide)), t);
      } else {
        hSide = ppSample(vec2(uRaw, vSide));
      }
      if (ppMappingBlend < 0.001) return hSide;
      float capThreshold = cos(radians(ppCapAngle));
      float blendHalf = ppSeamBandWidth * 0.5;
      float capW = smoothstep(capThreshold - blendHalf, capThreshold + blendHalf, absAxis);
      float hCap = ppSample(vec2(capX / C + 0.5, capY / C + 0.5));
      return mix(hSide, hCap, capW);

    } else if (ppMappingMode == 5) {
      vec3 blend = pow(abs(projN), vec3(4.0));
      blend /= dot(blend, vec3(1.0)) + 1e-6;
      float yzU = (pos.y - ppBoundsMin.y) / md; if (projN.x < 0.0) yzU = -yzU;
      float xzU = (pos.x - ppBoundsMin.x) / md; if (projN.y > 0.0) xzU = -xzU;
      float xyU = (pos.x - ppBoundsMin.x) / md; if (projN.z < 0.0) xyU = -xyU;
      float hXY = ppSample(vec2(xyU, (pos.y - ppBoundsMin.y) / md));
      float hXZ = ppSample(vec2(xzU, (pos.z - ppBoundsMin.z) / md));
      float hYZ = ppSample(vec2(yzU, (pos.z - ppBoundsMin.z) / md));
      return hXY * blend.z + hXZ * blend.y + hYZ * blend.x;

    } else {
      float yzU = (pos.y - ppBoundsMin.y) / md; if (projN.x < 0.0) yzU = -yzU;
      float xzU = (pos.x - ppBoundsMin.x) / md; if (projN.y > 0.0) xzU = -xzU;
      float xyU = (pos.x - ppBoundsMin.x) / md; if (projN.z < 0.0) xyU = -xyU;
      float hYZ = ppSample(vec2(yzU, (pos.z - ppBoundsMin.z) / md));
      float hXZ = ppSample(vec2(xzU, (pos.z - ppBoundsMin.z) / md));
      float hXY = ppSample(vec2(xyU, (pos.y - ppBoundsMin.y) / md));
      vec3 bN = blendN;
      vec3 af = abs(projN);
      float fp = max(af.x, max(af.y, af.z));
      float fs = af.x + af.y + af.z - fp - min(af.x, min(af.y, af.z));
      if (fp - fs <= PP_EPS) bN = projN;
      vec3 w = ppCubicWeights(bN);
      return hYZ * w.x + hXZ * w.y + hXY * w.z;
    }
  }
`

/** MODE_CYLINDRICAL from mesh-engine/mapping.js. */

export interface PatternPreviewMaterialInput {
  sourceMaterial: Material
  settings: EngineLayerSettings
  amplitude: number
  bounds: EngineBounds
  texture: DataTexture
  textureAspectU: number
  textureAspectV: number
  /** Physically move vertices (real height). Default true. */
  useDisplacement?: boolean
}

/** Build a DataTexture from displacement ImageData (grey in .r). */
export function makeDisplacementDataTexture(imageData: ImageData): DataTexture {
  const tex = new DataTexture(
    new Uint8Array(imageData.data.buffer.slice(0)),
    imageData.width,
    imageData.height,
    RGBAFormat,
  )
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.needsUpdate = true
  return tex
}

function buildUniforms(input: PatternPreviewMaterialInput): Record<string, { value: unknown }> {
  const { settings: s, bounds: b } = input
  const cyl = s.mappingMode === MODE_CYLINDRICAL && !!s.cylAxis
  return {
    ppDisplacementMap: { value: input.texture },
    ppMappingMode: { value: s.mappingMode },
    ppScaleUV: { value: new Vector2(s.scaleU, s.scaleV) },
    ppAmplitude: { value: input.amplitude },
    ppOffsetUV: { value: new Vector2(s.offsetU ?? 0, s.offsetV ?? 0) },
    ppRotation: { value: ((s.rotation ?? 0) * Math.PI) / 180 },
    ppBoundsMin: { value: new Vector3(b.min.x, b.min.y, b.min.z) },
    ppBoundsSize: { value: new Vector3(b.size.x, b.size.y, b.size.z) },
    ppBoundsCenter: { value: new Vector3(b.center.x, b.center.y, b.center.z) },
    ppTextureAspect: { value: new Vector2(input.textureAspectU, input.textureAspectV) },
    ppMappingBlend: { value: s.mappingBlend ?? 1 },
    ppSeamBandWidth: { value: s.seamBandWidth ?? 0.5 },
    ppCapAngle: { value: 20.0 },
    ppSymmetric: { value: s.symmetricDisplacement ? 1 : 0 },
    ppUseDisplacement: { value: input.useDisplacement === false ? 0 : 1 },
    ppHasCylFrame: { value: cyl ? 1 : 0 },
    ppCylAxis: { value: cyl ? new Vector3(s.cylAxis!.x, s.cylAxis!.y, s.cylAxis!.z) : new Vector3(0, 0, 1) },
    ppCylRight: { value: cyl ? new Vector3(s.cylRight!.x, s.cylRight!.y, s.cylRight!.z) : new Vector3(1, 0, 0) },
    ppCylUp: { value: cyl ? new Vector3(s.cylUp!.x, s.cylUp!.y, s.cylUp!.z) : new Vector3(0, 1, 0) },
    ppCylCenter: {
      value: cyl
        ? new Vector3(s.cylCenter!.x, s.cylCenter!.y, s.cylCenter!.z)
        : new Vector3(b.center.x, b.center.y, b.center.z),
    },
    ppCylRadius: { value: s.cylinderRadius ?? Math.max(b.size.x, b.size.y) * 0.5 },
  }
}

/**
 * Clone `sourceMaterial` and inject pattern displacement + bump. The returned
 * material renders identically to the original except for the added relief.
 */
export function createPatternPreviewMaterial(input: PatternPreviewMaterialInput): Material {
  const material = input.sourceMaterial.clone()
  // Skirt walls can face either way; render both sides so they always close.
  material.side = DoubleSide
  const uniforms = buildUniforms(input)

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    // ── Vertex: displace along ppDispDir (the welded surface normal, shared by
    // a surface boundary vertex and the skirt-top at the same position so the
    // seam stays welded). ppDispScale pins skirt bottoms to the surface. ──
    shader.vertexShader = `${heightGLSL}
      attribute vec3 ppDispDir;
      attribute float ppDispScale;
      varying vec3 vPPModelPos;
      varying vec3 vPPModelNormal;
      ${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          {
            vec3 ppDir = length(ppDispDir) > 1e-6 ? normalize(ppDispDir) : objectNormal;
            float ppH = ppHeight(position, ppDir, ppDir);
            if (ppSymmetric == 1) ppH -= 0.5;
            if (ppUseDisplacement == 1) transformed += ppDir * ppH * ppAmplitude * ppDispScale;
            vPPModelNormal = ppDir;
          }
          vPPModelPos = position;`,
      )

    // ── Fragment: perturb the lighting normal for sub-vertex relief. ──
    shader.fragmentShader = `${heightGLSL}
      varying vec3 vPPModelPos;
      varying vec3 vPPModelNormal;
      float ppGetHeight() {
        vec3 dpx = dFdx(vPPModelPos);
        vec3 dpy = dFdy(vPPModelPos);
        vec3 fN  = cross(dpx, dpy);
        vec3 PN  = length(fN) > 1e-10 ? normalize(fN) : vPPModelNormal;
        return ppHeight(vPPModelPos, PN, vPPModelNormal);
      }
      ${shader.fragmentShader}`
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
          {
            vec3 vpos = -vViewPosition;              // displaced view-space position
            vec3 dp1 = dFdx(vpos);
            vec3 dp2 = dFdy(vpos);
            if (ppUseDisplacement == 1) {
              // The relief already lives in the geometry — derive the shading
              // normal from the displaced surface itself. This is stable (no
              // high-frequency texture-derivative aliasing / stippling) and
              // reflects the true faceting the vertices produced.
              vec3 geoN = cross(dp1, dp2);
              if (length(geoN) > 1e-12) {
                geoN = normalize(geoN);
                if (dot(geoN, vpos) > 0.0) geoN = -geoN; // face the camera
                normal = geoN;
              }
            } else {
              // Bump-only mode: fake the relief by perturbing the flat normal
              // from the height gradient.
              float ppH = ppGetHeight();
              if (ppSymmetric == 1) ppH -= 0.5;
              float dhx = dFdx(ppH);
              float dhy = dFdy(ppH);
              vec3 ppN = normalize(normal);
              vec3 ppT = dp1 - dot(dp1, ppN) * ppN;
              vec3 ppB = dp2 - dot(dp2, ppN) * ppN;
              ppT = length(ppT) > 1e-5 ? normalize(ppT) : vec3(1.0, 0.0, 0.0);
              ppB = length(ppB) > 1e-5 ? normalize(ppB) : vec3(0.0, 1.0, 0.0);
              float ppScale = max(length(dp1) + length(dp2), 1e-6);
              float ppBump = ppAmplitude * 6.0 / ppScale;
              normal = normalize(ppN - ppBump * (dhx * ppT + dhy * ppB));
            }
          }`,
      )
  }
  // Force three to compile this as its own program variant (not shared with
  // the un-patched clone of the same base material).
  material.customProgramCacheKey = () => 'pattern-preview-v1'
  material.needsUpdate = true
  return material
}
