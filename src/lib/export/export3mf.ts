import type { Object3D } from 'three'
import { collectExportableMeshes } from './collectExportableMeshes'
import { createZip } from './zipWriter'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

function formatNumber(n: number): string {
  // Compact but precise enough for print geometry.
  return Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') || '0' : '0'
}

function buildModelXml(vertices: number[], indices: number[]): string {
  const vertexRows: string[] = []
  for (let i = 0; i < vertices.length; i += 3) {
    vertexRows.push(
      `<vertex x="${formatNumber(vertices[i])}" y="${formatNumber(vertices[i + 1])}" z="${formatNumber(vertices[i + 2])}"/>`,
    )
  }

  const triangleRows: string[] = []
  for (let i = 0; i < indices.length; i += 3) {
    triangleRows.push(
      `<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`,
    )
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${vertexRows.join('\n')}
        </vertices>
        <triangles>
${triangleRows.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`
}

/**
 * Serialize an exportable object tree into a valid .3mf package (a ZIP with the
 * required OPC parts). Only committed/exportable geometry is included; preview,
 * selection, helper, grid, camera, and light objects are excluded by the
 * collector's userData flags.
 */
export function export3mf(object: Object3D): Uint8Array {
  const { vertices, indices } = collectExportableMeshes(object)
  if (indices.length === 0) {
    throw new Error('No exportable geometry found for 3MF export.')
  }

  const modelXml = buildModelXml(vertices, indices)
  const encoder = new TextEncoder()

  return createZip([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(RELS) },
    { name: '3D/3dmodel.model', data: encoder.encode(modelXml) },
  ])
}
