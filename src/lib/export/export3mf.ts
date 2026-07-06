import type { Object3D } from 'three'
import { collectExportableMeshes } from './collectExportableMeshes'
import type { ExportProgressCallback } from './exportProgress'
import { yieldIfBusy } from './exportProgress'
import { createZipDeflated } from './zipWriter'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

const MODEL_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources>
<object id="1" type="model">
<mesh>
<vertices>
`

const MODEL_MID = `
</vertices>
<triangles>
`

const MODEL_FOOTER = `
</triangles>
</mesh>
</object>
</resources>
<build>
<item objectid="1"/>
</build>
</model>`

const XML_CHUNK = 16_384

/** 0.001 mm quantization — enough for FDM/SLA while shrinking XML payload. */
function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const q = Math.round(n * 1000) / 1000
  const text = q.toFixed(3)
  return text.replace(/\.?0+$/, '') || '0'
}

async function buildModelXml(
  vertices: number[],
  indices: number[],
  onProgress?: ExportProgressCallback,
): Promise<string> {
  const vertexCount = vertices.length / 3
  const triangleCount = indices.length / 3
  const parts: string[] = [MODEL_HEADER]

  for (let vi = 0; vi < vertexCount; vi++) {
    const o = vi * 3
    parts.push(
      `<vertex x="${formatCoord(vertices[o]!)}" y="${formatCoord(vertices[o + 1]!)}" z="${formatCoord(vertices[o + 2]!)}"/>\n`,
    )
    if (vi > 0 && vi % XML_CHUNK === 0) {
      onProgress?.(0.1 + (vi / vertexCount) * 0.45, 'Writing vertices…')
      await yieldIfBusy()
    }
  }

  parts.push(MODEL_MID)

  for (let ti = 0; ti < triangleCount; ti++) {
    const o = ti * 3
    parts.push(
      `<triangle v1="${indices[o]!}" v2="${indices[o + 1]!}" v3="${indices[o + 2]!}"/>\n`,
    )
    if (ti > 0 && ti % XML_CHUNK === 0) {
      onProgress?.(0.55 + (ti / triangleCount) * 0.35, 'Writing triangles…')
      await yieldIfBusy()
    }
  }

  parts.push(MODEL_FOOTER)
  onProgress?.(0.92, 'Packaging model…')
  return parts.join('')
}

/**
 * Serialize an exportable object tree into a valid .3mf package (a ZIP with the
 * required OPC parts). Only committed/exportable geometry is included; preview,
 * selection, helper, grid, camera, and light objects are excluded by the
 * collector's userData flags.
 */
export async function export3mf(
  object: Object3D,
  onProgress?: ExportProgressCallback,
): Promise<Uint8Array> {
  onProgress?.(0.02, 'Collecting geometry…')
  const { vertices, indices } = collectExportableMeshes(object)
  if (indices.length === 0) {
    throw new Error('No exportable geometry found for 3MF export.')
  }

  onProgress?.(0.08, 'Building 3MF model…')
  const modelXml = await buildModelXml(vertices, indices, onProgress)
  const encoder = new TextEncoder()

  onProgress?.(0.94, 'Compressing package…')
  const zip = await createZipDeflated([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(RELS) },
    { name: '3D/3dmodel.model', data: encoder.encode(modelXml) },
  ])

  onProgress?.(1, 'Done')
  return zip
}
