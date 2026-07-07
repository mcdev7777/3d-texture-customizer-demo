#!/usr/bin/env node
/**
 * Inspect a .3mf package: vertex/triangle counts and bounding box.
 * Usage: node scripts/inspect-3mf.mjs path/to/model.3mf
 */

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/inspect-3mf.mjs <file.3mf>')
  process.exit(1)
}

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

let xml
try {
  xml = execFileSync('unzip', ['-p', filePath, '3D/3dmodel.model'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
} catch {
  console.error('Could not read 3D/3dmodel.model from zip. Is unzip installed?')
  process.exit(1)
}

const vertexMatches = xml.match(/<vertex\b/g) ?? []
const triangleMatches = xml.match(/<triangle\b/g) ?? []

const xs = []
const ys = []
const zs = []

const vertexRe = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g
let m
while ((m = vertexRe.exec(xml)) !== null) {
  const x = Number(m[1])
  const y = Number(m[2])
  const z = Number(m[3])
  xs.push(x)
  ys.push(y)
  zs.push(z)
}

function minVal(arr) {
  if (!arr.length) return 0
  let v = arr[0]
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < v) v = arr[i]
  }
  return v
}

function maxVal(arr) {
  if (!arr.length) return 0
  let v = arr[0]
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > v) v = arr[i]
  }
  return v
}

const size = {
  x: maxVal(xs) - minVal(xs),
  y: maxVal(ys) - minVal(ys),
  z: maxVal(zs) - minVal(zs),
}

const fileSize = readFileSync(filePath).byteLength

console.log(`File: ${filePath}`)
console.log(`Package size: ${(fileSize / 1024).toFixed(1)} KB`)
console.log(`Vertices: ${vertexMatches.length.toLocaleString()}`)
console.log(`Triangles: ${triangleMatches.length.toLocaleString()}`)
console.log(
  `Bounding box (mm): ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`,
)
console.log(
  `Vertex range X: ${minVal(xs).toFixed(3)} .. ${maxVal(xs).toFixed(3)}`,
)
console.log(
  `Vertex range Y: ${minVal(ys).toFixed(3)} .. ${maxVal(ys).toFixed(3)}`,
)
console.log(
  `Vertex range Z: ${minVal(zs).toFixed(3)} .. ${maxVal(zs).toFixed(3)}`,
)

if (triangleMatches.length < 5000) {
  console.warn('WARNING: triangle count is very low — likely original mesh, not baked relief.')
}
if (Math.max(size.x, size.y, size.z) < 10) {
  console.warn('WARNING: bounding box under 10 mm — likely viewer-normalized scale, not source mm.')
}
