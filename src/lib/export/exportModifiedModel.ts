import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { Object3D } from 'three'
import type { ExportFormat } from '../../types/bake'
import { downloadBlob } from './downloadBlob'
import { export3mf } from './export3mf'
import { buildExportScene } from './buildExportScene'
import { disposeExportCloneGeometries } from '../three/scheduleDispose'

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_') || 'model'
}

function defaultFileName(baseName: string, format: ExportFormat): string {
  const safe = sanitizeFileName(baseName)
  return `${safe}.${format}`
}

function prepareExportRoot(object: Object3D): Object3D {
  return buildExportScene(object)
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
}): Promise<void> {
  const { object, format } = params
  const baseName = params.fileName ?? 'textured-model'
  const exportRoot = prepareExportRoot(object)

  try {
    switch (format) {
      case 'glb': {
        const buffer = await exportGlb(exportRoot)
        downloadBlob(buffer, defaultFileName(baseName, 'glb'), 'model/gltf-binary')
        break
      }
      case 'stl': {
        const buffer = exportStl(exportRoot)
        downloadBlob(buffer, defaultFileName(baseName, 'stl'), 'application/octet-stream')
        break
      }
      case 'obj': {
        const text = exportObj(exportRoot)
        downloadBlob(text, defaultFileName(baseName, 'obj'), 'text/plain')
        break
      }
      case '3mf': {
        const zip = export3mf(exportRoot)
        const blob = new Blob([zip as BlobPart], {
          type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
        })
        downloadBlob(blob, defaultFileName(baseName, '3mf'), blob.type)
        break
      }
      default: {
        const _exhaustive: never = format
        throw new Error(`Unsupported export format: ${_exhaustive}`)
      }
    }
  } finally {
    // Dispose cloned geometries only — materials/textures are shared with the live scene.
    disposeExportCloneGeometries(exportRoot)
  }
}
