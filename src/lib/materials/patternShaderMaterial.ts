import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Material,
  type Mesh,
  type Texture,
} from 'three'
import type { SelectionMode } from '../../types/surfaceSelection'
import type { SurfacePatternSettings } from '../../types/pattern'
import { createSurfaceProjectionFromHighlight, type SurfaceProjection } from '../geometry/surfaceProjection'
import { BASE_TILE_WORLD, depthLevelToWorld } from '../textures/patternPlacementMath'
import { computeEmphasisColor, extractBaseColor } from './extractBaseColor'
import { getPatternTexture, getPatternTextureAspect } from './patternTexture'
import { computePatternBounds, type PatternBounds } from './patternBounds'

const MAPPING_PLANAR = 0
const MAPPING_CUBIC = 1

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D patternMap;
  uniform vec3 baseColor;
  uniform vec3 emphasisColor;
  uniform vec3 originWorld;
  uniform vec3 tangentWorld;
  uniform vec3 bitangentWorld;
  uniform float tileWorld;
  uniform float rotationRad;
  uniform vec2 offsetUV;
  uniform vec2 textureAspect;
  uniform float bumpStrength;
  uniform int engraveMode;
  uniform int mappingMode;
  uniform vec3 boundsMin;
  uniform vec3 boundsSize;
  uniform float metalness;
  uniform float roughness;

  varying vec3 vWorldPos;
  varying vec3 vViewPos;
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;

  const float CUBIC_AXIS_EPSILON = 1e-4;

  int dominantCubicAxis(vec3 n) {
    vec3 absN = abs(n);
    if (absN.x >= absN.y - CUBIC_AXIS_EPSILON && absN.x >= absN.z - CUBIC_AXIS_EPSILON) return 0;
    if (absN.y >= absN.z - CUBIC_AXIS_EPSILON) return 1;
    return 2;
  }

  vec3 cubicBlendWeights(vec3 n) {
    vec3 absN = abs(n);
    int axis = dominantCubicAxis(n);
    if (axis == 0) return vec3(1.0, 0.0, 0.0);
    if (axis == 1) return vec3(0.0, 1.0, 0.0);
    return vec3(0.0, 0.0, 1.0);
  }

  float samplePatternMap(vec2 rawUV) {
    vec2 uv = (rawUV * textureAspect) / tileWorld;
    float c = cos(rotationRad);
    float s = sin(rotationRad);
    uv -= 0.5;
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
    uv += 0.5;
    uv += offsetUV;
    return texture2D(patternMap, uv).r;
  }

  float patternHeightPlanar(vec3 pos) {
    vec3 rel = pos - originWorld;
    float uWorld = dot(rel, tangentWorld);
    float vWorld = dot(rel, bitangentWorld);
    return samplePatternMap(vec2(uWorld, vWorld));
  }

  float patternHeightCubic(vec3 pos, vec3 projN) {
    float md = max(max(boundsSize.x, max(boundsSize.y, boundsSize.z)), 1e-4);

    float yzU = (pos.y - boundsMin.y) / md;
    if (projN.x < 0.0) yzU = -yzU;
    float xzU = (pos.x - boundsMin.x) / md;
    if (projN.y > 0.0) xzU = -xzU;
    float xyU = (pos.x - boundsMin.x) / md;
    if (projN.z < 0.0) xyU = -xyU;

    float hXY = samplePatternMap(vec2(xyU, (pos.y - boundsMin.y) / md));
    float hXZ = samplePatternMap(vec2(xzU, (pos.z - boundsMin.z) / md));
    float hYZ = samplePatternMap(vec2(yzU, (pos.z - boundsMin.z) / md));

    vec3 wts = cubicBlendWeights(projN);
    return hXY * wts.z + hXZ * wts.y + hYZ * wts.x;
  }

  float patternHeight(vec3 pos, vec3 projN) {
    if (mappingMode == 1) return patternHeightCubic(pos, projN);
    return patternHeightPlanar(pos);
  }

  float patternEmphasis(float h) {
    float emphasis = 1.0 - h;
    if (engraveMode == 1) emphasis = 1.0 - emphasis;
    return clamp(emphasis, 0.0, 1.0);
  }

  vec3 shade(vec3 albedo, vec3 N) {
    vec3 L1 = normalize(vec3(0.5, 0.8, 1.0));
    vec3 L2 = normalize(vec3(-0.5, -0.2, -0.6));
    vec3 V = normalize(-vViewPos);
    float diff1 = max(dot(N, L1), 0.0);
    float diff2 = max(dot(N, L2), 0.0) * 0.35;
    vec3 H = normalize(L1 + V);
    float spec = pow(max(dot(N, H), 0.0), mix(8.0, 64.0, 1.0 - roughness)) * (0.15 + (1.0 - roughness) * 0.45);
    vec3 lit = albedo * (0.45 + diff1 * 0.55 + diff2 * 0.15);
    lit += vec3(spec) * (0.25 + metalness * 0.35);
    return lit;
  }

  void main() {
    vec3 N = normalize(vViewNormal);
    N *= gl_FrontFacing ? 1.0 : -1.0;

    vec3 dpx = dFdx(vWorldPos);
    vec3 dpy = dFdy(vWorldPos);
    vec3 faceN = cross(dpx, dpy);
    vec3 projN = length(faceN) > 1e-10 ? normalize(faceN) : normalize(vWorldNormal);

    float rawH = patternHeight(vWorldPos, projN);
    float emphasis = patternEmphasis(rawH);
    vec3 albedo = mix(baseColor, emphasisColor, emphasis);

    // Bump from emphasis field (black = high) so depth drives shadow, not albedo.
    float dhx = dFdx(emphasis);
    float dhy = dFdy(emphasis);

    vec3 dp1 = dFdx(vViewPos);
    vec3 dp2 = dFdy(vViewPos);
    vec3 T = dp1 - dot(dp1, N) * N;
    vec3 B = dp2 - dot(dp2, N) * N;
    float lenT = length(T);
    float lenB = length(B);
    T = lenT > 1e-5 ? T / lenT : vec3(1.0, 0.0, 0.0);
    B = lenB > 1e-5 ? B / lenB : vec3(0.0, 1.0, 0.0);

    float posScale = max(length(dp1) + length(dp2), 1e-6);
    float bumpScale = bumpStrength * 6.0 / posScale;
    vec3 bumpVec = N - bumpScale * (dhx * T + dhy * B);
    vec3 bumpN = length(bumpVec) > 1e-6 ? normalize(bumpVec) : N;

    vec3 color = shade(albedo, bumpN);
    gl_FragColor = vec4(color, 1.0);
  }
`

export interface PatternMaterialOptions {
  settings: SurfacePatternSettings
  projection: SurfaceProjection
  baseMaterial: Material
  patternTexture?: Texture
  mappingMode: SelectionMode
  bounds?: PatternBounds
}

function readMaterialProps(material: Material): { metalness: number; roughness: number } {
  if ('metalness' in material && 'roughness' in material) {
    return {
      metalness: typeof material.metalness === 'number' ? material.metalness : 0.15,
      roughness: typeof material.roughness === 'number' ? material.roughness : 0.55,
    }
  }
  return { metalness: 0.1, roughness: 0.6 }
}

function buildUniforms(options: PatternMaterialOptions) {
  const { settings, projection, baseMaterial, mappingMode, bounds } = options
  const patternId = settings.patternId
  if (!patternId) throw new Error('Pattern id is required.')

  const baseColor = extractBaseColor(baseMaterial)
  const emphasisColor = computeEmphasisColor(baseColor)
  const { metalness, roughness } = readMaterialProps(baseMaterial)
  const tileWorld = BASE_TILE_WORLD / Math.max(0.05, settings.scale)
  const aspect = getPatternTextureAspect(patternId)
  const b = bounds ?? {
    min: new Vector3(),
    max: new Vector3(1, 1, 1),
    center: new Vector3(0.5, 0.5, 0.5),
    size: new Vector3(1, 1, 1),
  }

  return {
    patternMap: { value: options.patternTexture ?? getPatternTexture(patternId) },
    baseColor: { value: baseColor },
    emphasisColor: { value: emphasisColor },
    originWorld: { value: projection.originWorld.clone() },
    tangentWorld: { value: projection.tangentWorld.clone() },
    bitangentWorld: { value: projection.bitangentWorld.clone() },
    tileWorld: { value: tileWorld },
    rotationRad: { value: (settings.rotation * Math.PI) / 180 },
    offsetUV: { value: new Vector2(settings.offsetX, settings.offsetY) },
    textureAspect: { value: new Vector2(aspect.u, aspect.v) },
    bumpStrength: { value: depthLevelToWorld(settings.depth) },
    engraveMode: { value: settings.mode === 'engrave' ? 1 : 0 },
    mappingMode: { value: mappingMode === 'part' ? MAPPING_CUBIC : MAPPING_PLANAR },
    boundsMin: { value: b.min.clone() },
    boundsSize: { value: b.size.clone() },
    metalness: { value: metalness },
    roughness: { value: roughness },
  }
}

export function createPatternShaderMaterial(options: PatternMaterialOptions): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: buildUniforms(options),
    side: DoubleSide,
  })
  material.userData.isPatternMaterial = true
  return material
}

export function updatePatternShaderMaterial(
  material: ShaderMaterial,
  options: PatternMaterialOptions,
): void {
  const patternId = options.settings.patternId
  if (!patternId) return

  const next = buildUniforms(options)
  for (const [key, uniform] of Object.entries(next)) {
    const existing = material.uniforms[key]
    if (!existing) continue
    if (uniform.value instanceof Vector3) existing.value.copy(uniform.value)
    else if (uniform.value instanceof Vector2) existing.value.copy(uniform.value)
    else existing.value = uniform.value
  }
  material.needsUpdate = true
}

export function buildProjectionForMesh(
  mesh: Mesh,
  worldNormal: Vector3,
  fallbackCenter?: Vector3,
  triangleIndices?: readonly number[],
  sourceGeometry?: BufferGeometry,
): SurfaceProjection {
  mesh.updateWorldMatrix(true, false)
  const geo = sourceGeometry ?? mesh.geometry
  const pos = geo.getAttribute('position')
  const index = geo.index

  const positions: number[] = []
  const triList =
    triangleIndices ??
    Array.from({ length: (index ? index.count : pos.count) / 3 }, (_, i) => i)

  for (const t of triList) {
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(t * 3 + k) : t * 3 + k
      const v = new Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
      v.applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
    }
  }

  const highlight = new BufferGeometry()
  highlight.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const projection = createSurfaceProjectionFromHighlight(highlight, worldNormal, fallbackCenter)
  highlight.dispose()
  return projection
}

export function buildPatternMaterialOptions(
  mesh: Mesh,
  stateGeometry: BufferGeometry,
  region: {
    settings: SurfacePatternSettings
    baseColorHex: number
    normal: Vector3
    anchor: Vector3
    triangleIndices: readonly number[]
    selectionType: SelectionMode
  },
  baseMaterial: Material,
): PatternMaterialOptions {
  const tint = baseMaterial.clone()
  if ('color' in tint && tint.color) tint.color.setHex(region.baseColorHex)

  const projection = buildProjectionForMesh(
    mesh,
    region.normal,
    region.anchor,
    region.triangleIndices,
    stateGeometry,
  )

  const bounds =
    region.selectionType === 'part'
      ? computePatternBounds(mesh, stateGeometry, region.triangleIndices)
      : undefined

  return {
    settings: region.settings,
    projection,
    baseMaterial: tint,
    mappingMode: region.selectionType,
    bounds,
  }
}
