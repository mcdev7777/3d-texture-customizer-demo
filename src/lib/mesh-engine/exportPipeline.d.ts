export interface EngineBounds {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
  size: { x: number; y: number; z: number }
  center: { x: number; y: number; z: number }
}

export interface RegularizeOpts {
  aspectThreshold: number
  slack: number
  aggressiveSlack: number
  extremeSliverAspect: number
  maxNormalDeltaCos: number
  aggressiveNormalDeltaCos: number
}

export interface EngineSettings {
  mappingMode: number
  scaleU: number
  scaleV: number
  amplitude: number
  offsetU: number
  offsetV: number
  rotation: number
  refineLength: number
  maxTriangles: number
  bottomAngleLimit: number
  topAngleLimit: number
  smoothBottom: boolean
  harvestFlatFaces: boolean
  harvestTol: number
  regularizeEnabled: boolean
  regularizeSecondPassMul: number
  boundaryFalloff: number
  invertDisplacement: boolean
  symmetricDisplacement: boolean
  /** Cubic-mapping seam blend amount (0 = hard axis cutoff, 1 = full triplanar-style blend). */
  mappingBlend: number
  /** Width of the blend zone around a cubic-mapping seam. */
  seamBandWidth: number
  /** Laplacian smoothing iterations on the per-vertex blend normal that drives cubic/triplanar blend weights. */
  blendNormalSmoothing: number
}

/** Per-region displacement pass — everything a single texture/pattern needs to be baked in isolation. */
export interface EngineLayerSettings {
  mappingMode: number
  scaleU: number
  scaleV: number
  amplitude: number
  offsetU: number
  offsetV: number
  rotation: number
  invertDisplacement: boolean
  symmetricDisplacement: boolean
  mappingBlend: number
  seamBandWidth: number
  blendNormalSmoothing: number
}

export interface EngineLayer {
  /** 1 = triangle (indexed by ORIGINAL, pre-subdivision triangle id) belongs to this layer's region. */
  triangleSet: Uint8Array
  imageData: ImageData
  imgWidth: number
  imgHeight: number
  settings: EngineLayerSettings
}

export interface PipelineInput {
  positions: Float32Array
  faceWeights: Float32Array | null
  imageData: ImageData
  imgWidth: number
  imgHeight: number
  settings: EngineSettings
  bounds: EngineBounds
  regularizeOpts: RegularizeOpts
  mode: 'export' | 'bake'
  /**
   * When present (mode 'export' only), the displace stage runs once per
   * layer instead of the single imageData/imgWidth/imgHeight/settings
   * fields above — each layer's own pattern gets masked to only its own
   * region (via faceParentId ancestry) and applied on top of the previous
   * layer's output. `settings` still supplies the pipeline-global knobs
   * (refineLength, maxTriangles, regularize*, bottom clamp, harvest*).
   */
  layers?: EngineLayer[]
}

export interface RepairStats {
  beforeSlivers: number
  open: number
  nonManifold: number
  slivers: number
  tris: number
}

export interface PipelineResult {
  positions: Float32Array
  normals: Float32Array | null
  safetyCapHit: boolean
  runDecimation: boolean
  needsDecimation: boolean
  faceParentId: Int32Array | null
  repairStats: RepairStats | null
}

export type PipelineStage =
  | 'subdivide1'
  | 'regularize'
  | 'subdivide2'
  | 'displace'
  | 'decimate'
  | 'repair'

export type PipelineEventHandler = (
  stage: PipelineStage,
  p: number,
  info?: Record<string, unknown>,
) => void

export function runExportPipeline(
  input: PipelineInput,
  onEvent?: PipelineEventHandler,
  shouldAbort?: () => boolean,
): Promise<PipelineResult | null>
