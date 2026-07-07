import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import type { SelectionMode } from '../../types/surfaceSelection'
import type { SurfacePatternSettings } from '../../types/pattern'
import { DEPTH_MAX } from '../../types/pattern'
import { createSurfaceProjectionFromHighlight, type SurfaceProjection } from '../geometry/surfaceProjection'
import { getExportUnitScale, getSelectionTileWorld } from '../textures/patternPlacementMath'
import { depthLevelToDisplacementWorld } from '../pattern/patternDepth'
import { getPatternTexture, getPatternTextureAspect } from './patternTexture'
import { computePatternBounds, type PatternBounds } from './patternBounds'

const MAPPING_PLANAR = 0
const MAPPING_CUBIC = 1

type PatternUniformBag = Record<string, { value: unknown }>

const PATTERN_VERTEX_PARS = /* glsl */ `
varying vec3 vPatternWorldPos;
`

const PATTERN_VERTEX_ASSIGN = /* glsl */ `
vPatternWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`

const PATTERN_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D patternMap;
uniform vec3 patternOriginWorld;
uniform vec3 patternTangentWorld;
uniform vec3 patternBitangentWorld;
uniform float patternTileWorld;
uniform float patternSelectionWidth;
uniform float patternSelectionHeight;
// Pattern "Scale": a *size* multiplier, matching how scale works everywhere
// else in the app (image/texture editors, CAD) — scale 2 = each tile twice
// as big (fewer repeats across the selection); scale 0.5 = each tile half
// as big (more repeats — e.g. a 2x2 grid of tiles across the selection).
// UV is divided by it, not multiplied.
uniform float patternRepeatScale;
uniform float patternRotationRad;
uniform vec2 patternOffsetUV;
uniform vec2 patternTextureAspect;
uniform float patternAmplitude;
uniform int patternInvert;
uniform int patternEngraveMode;
uniform int patternMappingMode;
uniform vec3 patternBoundsMin;
uniform vec3 patternBoundsSize;

varying vec3 vPatternWorldPos;

const float PATTERN_CUBIC_AXIS_EPSILON = 1e-4;

int patternDominantCubicAxis(vec3 n) {
  vec3 absN = abs(n);
  if (absN.x >= absN.y - PATTERN_CUBIC_AXIS_EPSILON && absN.x >= absN.z - PATTERN_CUBIC_AXIS_EPSILON) return 0;
  if (absN.y >= absN.z - PATTERN_CUBIC_AXIS_EPSILON) return 1;
  return 2;
}

vec3 patternCubicBlendWeights(vec3 n) {
  int axis = patternDominantCubicAxis(n);
  if (axis == 0) return vec3(1.0, 0.0, 0.0);
  if (axis == 1) return vec3(0.0, 1.0, 0.0);
  return vec3(0.0, 0.0, 1.0);
}

float patternSampleMap(vec2 normUV) {
  vec2 uv = normUV;
  float c = cos(patternRotationRad);
  float s = sin(patternRotationRad);
  uv -= 0.5;
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv += 0.5;
  uv += patternOffsetUV;
  return texture2D(patternMap, uv).r;
}

float patternHeightPlanar(vec3 pos) {
  vec3 rel = pos - patternOriginWorld;
  float uWorld = dot(rel, patternTangentWorld);
  float vWorld = dot(rel, patternBitangentWorld);
  float pu = (uWorld / max(patternSelectionWidth, 1e-4) + 0.5) / patternRepeatScale;
  float pv = (vWorld / max(patternSelectionHeight, 1e-4) + 0.5) / patternRepeatScale;
  return patternSampleMap(vec2(pu, pv));
}

float patternHeightCubic(vec3 pos, vec3 projN) {
  float md = max(max(patternBoundsSize.x, max(patternBoundsSize.y, patternBoundsSize.z)), 1e-4);

  float yzU = (pos.y - patternBoundsMin.y) / md;
  if (projN.x < 0.0) yzU = -yzU;
  float xzU = (pos.x - patternBoundsMin.x) / md;
  if (projN.y > 0.0) xzU = -xzU;
  float xyU = (pos.x - patternBoundsMin.x) / md;
  if (projN.z < 0.0) xyU = -xyU;

  float hXY = patternSampleMap(vec2(xyU / patternRepeatScale, ((pos.y - patternBoundsMin.y) / md) / patternRepeatScale));
  float hXZ = patternSampleMap(vec2(xzU / patternRepeatScale, ((pos.z - patternBoundsMin.z) / md) / patternRepeatScale));
  float hYZ = patternSampleMap(vec2(yzU / patternRepeatScale, ((pos.z - patternBoundsMin.z) / md) / patternRepeatScale));

  vec3 wts = patternCubicBlendWeights(projN);
  return hXY * wts.z + hXZ * wts.y + hYZ * wts.x;
}

float patternHeightAt(vec3 pos, vec3 projN) {
  if (patternMappingMode == 1) return patternHeightCubic(pos, projN);
  return patternHeightPlanar(pos);
}

vec3 patternFaceNormal(vec3 pos) {
  vec3 dpx = dFdx(pos);
  vec3 dpy = dFdy(pos);
  vec3 faceN = cross(dpx, dpy);
  return length(faceN) > 1e-10 ? normalize(faceN) : vec3(0.0, 0.0, 1.0);
}
`

const PATTERN_BUMP_INJECT = /* glsl */ `
{
  vec3 patternProjN = patternFaceNormal(vPatternWorldPos);
  float patternRawH = patternHeightAt(vPatternWorldPos, patternProjN);
  float h = patternRawH;
  if (patternInvert == 1) h = 1.0 - h;
  float heightField = patternEngraveMode == 1 ? (1.0 - h) : h;

  float dhx = dFdx(heightField);
  float dhy = dFdy(heightField);

  vec3 dp1 = dFdx(vViewPosition);
  vec3 dp2 = dFdy(vViewPosition);
  vec3 T = dp1 - dot(dp1, normal) * normal;
  vec3 B = dp2 - dot(dp2, normal) * normal;
  T /= max(length(T), 1e-5);
  B /= max(length(B), 1e-5);
  float posScale = max(length(dp1) + length(dp2), 1e-6);
  float bumpStr = patternAmplitude * 6.0 / posScale;
  vec3 bumpNormal = normal - bumpStr * (dhx * T + dhy * B);
  normal = normalize(bumpNormal);
}
`

export interface PatternMaterialOptions {
  settings: SurfacePatternSettings
  projection: SurfaceProjection
  baseMaterial: Material
  sourceGeometry: BufferGeometry
  modelRoot: Object3D
  patternTexture?: Texture
  mappingMode: SelectionMode
  bounds?: PatternBounds
}

function isStandardCompatibleMaterial(
  material: Material,
): material is MeshStandardMaterial | MeshPhysicalMaterial | MeshPhongMaterial | MeshLambertMaterial {
  return (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshLambertMaterial
  )
}

function cloneBaseMaterial(material: Material): Material {
  try {
    return material.clone()
  } catch {
    return new MeshStandardMaterial()
  }
}

function ensureVertexColors(material: Material, geometry: BufferGeometry): void {
  if (!geometry.getAttribute('color')) return
  if (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshLambertMaterial ||
    material instanceof MeshBasicMaterial
  ) {
    material.vertexColors = true
  }
}

function buildUniforms(options: PatternMaterialOptions): PatternUniformBag {
  const { settings, projection, mappingMode, bounds, modelRoot } = options
  const patternId = settings.patternId
  if (!patternId) throw new Error('Pattern id is required.')

  const aspect = getPatternTextureAspect(patternId)
  const tileWorld = getSelectionTileWorld(projection, aspect.u, aspect.v, settings.scale)
  const amplitude = depthLevelToDisplacementWorld(settings.depth, getExportUnitScale(modelRoot))
  const b = bounds ?? {
    min: new Vector3(),
    max: new Vector3(1, 1, 1),
    center: new Vector3(0.5, 0.5, 0.5),
    size: new Vector3(1, 1, 1),
  }

  return {
    patternMap: { value: options.patternTexture ?? getPatternTexture(patternId) },
    patternOriginWorld: { value: projection.originWorld.clone() },
    patternTangentWorld: { value: projection.tangentWorld.clone() },
    patternBitangentWorld: { value: projection.bitangentWorld.clone() },
    patternTileWorld: { value: tileWorld },
    patternSelectionWidth: { value: projection.width },
    patternSelectionHeight: { value: projection.height },
    patternRepeatScale: { value: Math.max(0.05, settings.scale) },
    patternRotationRad: { value: (settings.rotation * Math.PI) / 180 },
    patternOffsetUV: { value: new Vector2(settings.offsetX, settings.offsetY) },
    patternTextureAspect: { value: new Vector2(aspect.u, aspect.v) },
    patternAmplitude: { value: amplitude },
    patternInvert: { value: settings.invert ? 1 : 0 },
    patternEngraveMode: { value: settings.mode === 'engrave' ? 1 : 0 },
    patternMappingMode: { value: mappingMode === 'part' ? MAPPING_CUBIC : MAPPING_PLANAR },
    patternBoundsMin: { value: b.min.clone() },
    patternBoundsSize: { value: b.size.clone() },
  }
}

function patternProgramCacheKey(options: PatternMaterialOptions): string {
  const { settings, mappingMode, projection } = options
  return `pattern:v7:${mappingMode}:${settings.mode}:${settings.patternId ?? 'none'}:${settings.depth.toFixed(2)}:${settings.scale.toFixed(2)}:${settings.rotation.toFixed(0)}:${settings.invert ? 1 : 0}:${projection.width.toFixed(3)}:${projection.height.toFixed(3)}`
}

function applyDepthMaterialFeel(material: Material, depth: number): void {
  if (
    !(material instanceof MeshStandardMaterial || material instanceof MeshPhysicalMaterial)
  ) {
    return
  }
  const t = Math.min(1, Math.max(0, depth / DEPTH_MAX))
  material.roughness = 0.56 - t * 0.2
  material.metalness = 0.12 + t * 0.06
}

function injectPatternShader(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: PatternUniformBag,
): void {
  Object.assign(shader.uniforms, uniforms)

  shader.vertexShader = shader.vertexShader.replace(
    'void main() {',
    `${PATTERN_VERTEX_PARS}\nvoid main() {`,
  )
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>\n${PATTERN_VERTEX_ASSIGN}`,
  )

  shader.fragmentShader = shader.fragmentShader.replace(
    'void main() {',
    `${PATTERN_FRAGMENT_PARS}\nvoid main() {`,
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>\n${PATTERN_BUMP_INJECT}`,
  )
}

function attachPatternHooks(material: Material, options: PatternMaterialOptions): Material {
  if (!isStandardCompatibleMaterial(material)) {
    return material
  }

  const uniforms = buildUniforms(options)
  material.userData.patternUniforms = uniforms
  material.side = DoubleSide
  material.customProgramCacheKey = () => patternProgramCacheKey(options)
  applyDepthMaterialFeel(material, options.settings.depth)

  material.onBeforeCompile = (shader) => {
    injectPatternShader(shader, material.userData.patternUniforms as PatternUniformBag)
  }

  material.needsUpdate = true
  return material
}

export function createPatternShaderMaterial(options: PatternMaterialOptions): Material {
  const material = cloneBaseMaterial(options.baseMaterial)
  ensureVertexColors(material, options.sourceGeometry)
  material.userData.isPatternMaterial = true

  if (isStandardCompatibleMaterial(material)) {
    return attachPatternHooks(material, options)
  }

  material.dispose()

  // Fallback for uncommon material types — flat shading with preserved diffuse color.
  const fallback = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.15,
  })
  ensureVertexColors(fallback, options.sourceGeometry)
  fallback.userData.isPatternMaterial = true
  return attachPatternHooks(fallback, options)
}

export function updatePatternShaderMaterial(material: Material, options: PatternMaterialOptions): void {
  const patternId = options.settings.patternId
  if (!patternId) return

  const next = buildUniforms(options)
  const existing = material.userData.patternUniforms as PatternUniformBag | undefined
  if (!existing) {
    material.userData.patternUniforms = next
    material.needsUpdate = true
    return
  }

  for (const [key, uniform] of Object.entries(next)) {
    const target = existing[key]
    if (!target) continue
    if (uniform.value instanceof Vector3) (target.value as Vector3).copy(uniform.value as Vector3)
    else if (uniform.value instanceof Vector2) (target.value as Vector2).copy(uniform.value as Vector2)
    else target.value = uniform.value
  }

  material.customProgramCacheKey = () => patternProgramCacheKey(options)
  applyDepthMaterialFeel(material, options.settings.depth)
  material.needsUpdate = true
}

export function buildPatternMaterialOptions(
  mesh: Mesh,
  modelRoot: Object3D,
  stateGeometry: BufferGeometry,
  region: {
    settings: SurfacePatternSettings
    normal: Vector3
    anchor: Vector3
    triangleIndices: readonly number[]
    selectionType: SelectionMode
    mappingMode?: SelectionMode
    cubicBoundsTriangles?: readonly number[]
  },
  baseMaterial: Material,
): PatternMaterialOptions {
  const mappingMode = region.mappingMode ?? region.selectionType
  const projection = buildProjectionForMesh(
    mesh,
    region.normal,
    region.anchor,
    region.triangleIndices,
    stateGeometry,
  )

  const boundsTriangles =
    mappingMode === 'part'
      ? (region.cubicBoundsTriangles ?? region.triangleIndices)
      : region.triangleIndices
  const bounds =
    mappingMode === 'part'
      ? computePatternBounds(mesh, stateGeometry, boundsTriangles)
      : undefined

  return {
    settings: region.settings,
    projection,
    baseMaterial,
    sourceGeometry: stateGeometry,
    modelRoot,
    mappingMode,
    bounds,
  }
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

export function isPatternShaderMaterial(material: Material): material is Material {
  return material.userData.isPatternMaterial === true
}
