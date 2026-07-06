export type BakeStatus = 'idle' | 'applying' | 'exporting' | 'error'

export type ExportFormat = 'stl' | 'obj' | 'glb' | '3mf'

export type ExportQuality = 'low' | 'medium' | 'high'

export const DEFAULT_EXPORT_QUALITY: ExportQuality = 'medium'
