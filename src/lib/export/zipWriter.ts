/**
 * Minimal ZIP writer with optional DEFLATE compression.
 *
 * A 3MF file is an OPC (ZIP) package. BumpMesh and most slicers expect deflated
 * entries — stored (uncompressed) archives can be 10–20× larger on disk.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodeName(name: string): Uint8Array {
  return new TextEncoder().encode(name)
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    return data
  }

  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))

  const compressed = await new Response(stream).arrayBuffer()
  return new Uint8Array(compressed)
}

function buildZip(
  entries: Array<{ name: string; data: Uint8Array; compressed: Uint8Array; method: number }>,
): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encodeName(entry.name)
    const crc = crc32(entry.data)
    const uncompressedSize = entry.data.length
    const compressedSize = entry.compressed.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, entry.method, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, compressedSize, true)
    lv.setUint32(22, uncompressedSize, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    localParts.push(local, entry.compressed)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, entry.method, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, compressedSize, true)
    cv.setUint32(24, uncompressedSize, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + entry.compressed.length
  }

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0)
  const centralOffset = offset

  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralOffset, true)
  ev.setUint16(20, 0, true)

  const total =
    localParts.reduce((sum, p) => sum + p.length, 0) + centralSize + end.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, pos)
    pos += part.length
  }
  return out
}

/** Build a ZIP archive (stored / no compression). */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const packed = entries.map((entry) => ({
    name: entry.name,
    data: entry.data,
    compressed: entry.data,
    method: 0,
  }))
  return buildZip(packed)
}

/**
 * Build a ZIP archive with DEFLATE-compressed entries (method 8).
 * Falls back to stored entries when CompressionStream is unavailable.
 */
export async function createZipDeflated(entries: ZipEntry[]): Promise<Uint8Array> {
  const packed = await Promise.all(
    entries.map(async (entry) => {
      const compressed = await deflateRaw(entry.data)
      const useDeflate =
        typeof CompressionStream !== 'undefined' && compressed.length < entry.data.length
      return {
        name: entry.name,
        data: entry.data,
        compressed: useDeflate ? compressed : entry.data,
        method: useDeflate ? 8 : 0,
      }
    }),
  )
  return buildZip(packed)
}
