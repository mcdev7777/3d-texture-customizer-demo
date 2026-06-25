/**
 * CLI smoke test for model loading. Usage:
 *   npm run test:load -- "/path/to/Mini Toolbox.3mf"
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { Box3, Group, Vector3 } from 'three'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npm run test:load -- <path-to-model>')
  process.exit(1)
}

const buffer = readFileSync(filePath)
const fileName = basename(filePath)
const ext = fileName.split('.').pop()?.toLowerCase()

async function load(): Promise<Object3D> {
  const url = `file://${filePath}`
  switch (ext) {
    case 'stl': {
      const geo = new STLLoader().parse(buffer.buffer)
      return new Mesh(geo, new MeshStandardMaterial())
    }
    case 'obj':
      return new OBJLoader().parse(buffer.toString())
    case 'glb':
    case 'gltf':
      return (await new GLTFLoader().parseAsync(buffer.buffer, '')).scene
    case '3mf': {
      const loader = new ThreeMFLoader()
      try {
        return loader.parse(buffer.buffer)
      } catch {
        return await loader.loadAsync(url)
      }
    }
    default:
      throw new Error(`Unsupported: .${ext}`)
  }
}

function normalize(object: Object3D) {
  object.updateMatrixWorld(true)
  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  const wrapper = new Group()
  object.position.sub(center)
  wrapper.add(object)
  wrapper.scale.setScalar(4 / maxDim)
  wrapper.updateMatrixWorld(true)
  return { wrapper, box: new Box3().setFromObject(wrapper) }
}

let meshCount = 0
let verts = 0
let tris = 0

const object = await load()
object.traverse((c) => {
  if (c.isMesh) {
    meshCount++
    const g = c.geometry
    if (g instanceof BufferGeometry) {
      verts += g.getAttribute('position')?.count ?? 0
      tris += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
    }
  }
})

const { wrapper, box } = normalize(object)
const size = box.getSize(new Vector3())

console.log(JSON.stringify({
  file: fileName,
  type: ext?.toUpperCase(),
  meshCount,
  vertexCount: verts,
  triangleCount: Math.floor(tris),
  normalizedDimensions: {
    width: +size.x.toFixed(3),
    height: +size.y.toFixed(3),
    depth: +size.z.toFixed(3),
  },
}, null, 2))
