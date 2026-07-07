import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Object3D } from 'three'
import type { ExportFormat, ExportQuality } from '../../types/bake'
import type { SurfacePatternPlacement } from '../../types/pattern'
import { downloadBlob } from './downloadBlob'
import { export3mfFast } from './export3mfFast'
import { preparePrintableExport } from './preparePrintableExport'
import { clampProgress, type ExportProgressCallback } from './exportProgress'
import { disposeExportCloneGeometries } from '../three/scheduleDispose'

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_') || 'model'
}

function defaultFileName(baseName: string, format: ExportFormat): string {
  const safe = sanitizeFileName(baseName)
  return `${safe}.${format}`
}

async function exportGlb(object: Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result)
          return
        }
        reject(new Error('GLTFExporter returned unexpected format.'))
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true },
    )
  })
}

function exportStl(object: Object3D): ArrayBuffer {
  const exporter = new STLExporter()
  const output = exporter.parse(object, { binary: true })
  if (typeof output === 'string') {
    return new TextEncoder().encode(output).buffer as ArrayBuffer
  }
  if (output instanceof ArrayBuffer) {
    return output
  }
  if (ArrayBuffer.isView(output)) {
    return output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer
  }
  throw new Error('STLExporter returned unexpected binary format.')
}

function exportObj(object: Object3D): string {
  const exporter = new OBJExporter()
  return exporter.parse(object)
}

export async function exportModifiedModel(params: {
  object: Object3D
  format: ExportFormat
  fileName?: string
  placements: Record<string, SurfacePatternPlacement>
  committedSurfaceIds: readonly string[]
  quality: ExportQuality
  exportUnitScale: number
  onProgress?: ExportProgressCallback
}): Promise<void> {
  const { object, format, placements, committedSurfaceIds, quality, exportUnitScale, onProgress } =
    params
  const baseName = params.fileName ?? 'textured-model'

  const report = (fraction: number, label: string) => {
    onProgress?.(clampProgress(fraction), label)
  }

  report(0.01, 'Starting export…')

  if (format === '3mf') {
    const zip = await export3mfFast(object, {
      placements,
      committedSurfaceIds,
      quality,
      exportUnitScale,
      onProgress: (fraction, label) => report(fraction, label),
    })
    const blob = new Blob([zip as BlobPart], {
      type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    })
    downloadBlob(blob, defaultFileName(baseName, '3mf'), blob.type)
    return
  }

  const exportRoot = await preparePrintableExport(object, {
    placements,
    committedSurfaceIds,
    quality,
    exportUnitScale,
    onProgress: (fraction, label) => {
      report(0.02 + fraction * 0.88, label)
    },
  })

  try {
    switch (format) {
      case 'glb': {
        report(0.92, 'Writing GLB…')
        const buffer = await exportGlb(exportRoot)
        report(1, 'Download ready')
        downloadBlob(buffer, defaultFileName(baseName, 'glb'), 'model/gltf-binary')
        break
      }
      case 'stl': {
        report(0.92, 'Writing STL…')
        const buffer = exportStl(exportRoot)
        report(1, 'Download ready')
        downloadBlob(buffer, defaultFileName(baseName, 'stl'), 'application/octet-stream')
        break
      }
      case 'obj': {
        report(0.92, 'Writing OBJ…')
        const text = exportObj(exportRoot)
        report(1, 'Download ready')
        downloadBlob(text, defaultFileName(baseName, 'obj'), 'text/plain')
        break
      }
      default: {
        const _exhaustive: never = format
        throw new Error(`Unsupported export format: ${_exhaustive}`)
      }
    }
  } finally {
    disposeExportCloneGeometries(exportRoot)
  }
}
