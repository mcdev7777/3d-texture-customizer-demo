import type { CustomTexture } from '../../store/useCustomTextureStore'

export const CUSTOM_TEXTURE_STORAGE_KEY = 'texture-studio:custom-textures:v1'

const MAX_STORED_TEXTURES = 32

export interface StoredCustomTexture {
  id: string
  name: string
  dataUrl: string
}

function isStoredTexture(raw: unknown): raw is StoredCustomTexture {
  if (!raw || typeof raw !== 'object') return false
  const item = raw as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    item.id.startsWith('custom-') &&
    typeof item.name === 'string' &&
    typeof item.dataUrl === 'string' &&
    item.dataUrl.startsWith('data:image/')
  )
}

function readAll(): StoredCustomTexture[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEXTURE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isStoredTexture).slice(0, MAX_STORED_TEXTURES)
  } catch {
    return []
  }
}

function writeAll(textures: StoredCustomTexture[]): boolean {
  try {
    localStorage.setItem(CUSTOM_TEXTURE_STORAGE_KEY, JSON.stringify(textures))
    return true
  } catch {
    return false
  }
}

export function listStoredCustomTextures(): StoredCustomTexture[] {
  return readAll()
}

export function saveStoredCustomTextures(textures: StoredCustomTexture[]): void {
  const trimmed = textures.slice(0, MAX_STORED_TEXTURES)
  if (!writeAll(trimmed)) {
    throw new Error('Could not save custom textures — browser storage may be full.')
  }
}

export function upsertStoredCustomTexture(texture: StoredCustomTexture): void {
  const all = readAll()
  const index = all.findIndex((t) => t.id === texture.id)
  if (index >= 0) all[index] = texture
  else all.unshift(texture)
  saveStoredCustomTextures(all)
}

export function deleteStoredCustomTexture(id: string): void {
  saveStoredCustomTextures(readAll().filter((t) => t.id !== id))
}

export function clearStoredCustomTextures(): void {
  localStorage.removeItem(CUSTOM_TEXTURE_STORAGE_KEY)
}

export function canvasFromDataUrl(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas 2D unavailable'))
        return
      }
      ctx.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => reject(new Error('Could not decode stored texture.'))
    image.src = dataUrl
  })
}

export function toStoredCustomTexture(
  texture: CustomTexture,
  dataUrl: string,
): StoredCustomTexture {
  return {
    id: texture.id,
    name: texture.name,
    dataUrl,
  }
}

export function toCustomTexture(stored: StoredCustomTexture): CustomTexture {
  return {
    id: stored.id,
    name: stored.name,
    thumbnailUrl: stored.dataUrl,
  }
}
