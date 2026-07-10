export type BakeStatus = 'idle' | 'applying' | 'exporting' | 'error'

export type ExportFormat = 'stl' | 'obj' | 'glb' | '3mf'

/**
 * Export detail level as a 1–10 slider (client-requested). 1 is the fastest,
 * coarsest export; 10 is the finest. The numeric level is interpolated into a
 * full pipeline config by `getQualityConfig` in `subdivideSelection.ts`.
 */
export type ExportQuality = number

export const MIN_EXPORT_QUALITY = 1
export const MAX_EXPORT_QUALITY = 10

export const DEFAULT_EXPORT_QUALITY: ExportQuality = 5

/** Clamp/round an arbitrary input to a valid integer quality level. */
export function clampExportQuality(level: number): ExportQuality {
  if (!Number.isFinite(level)) return DEFAULT_EXPORT_QUALITY
  return Math.min(MAX_EXPORT_QUALITY, Math.max(MIN_EXPORT_QUALITY, Math.round(level)))
}
