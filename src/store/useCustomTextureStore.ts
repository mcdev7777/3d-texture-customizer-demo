import { create } from 'zustand'
import {
  imageToHeightMaskCanvas,
  registerCustomPatternCanvas,
  unregisterCustomPatternCanvas,
} from '../utils/patternTextures'
import {
  canvasFromDataUrl,
  clearStoredCustomTextures,
  deleteStoredCustomTexture,
  listStoredCustomTextures,
  toCustomTexture,
  toStoredCustomTexture,
  upsertStoredCustomTexture,
} from '../lib/textures/customTextureStorage'

export interface CustomTexture {
  id: string
  name: string
  /** Data URL used for the library thumbnail. */
  thumbnailUrl: string
}

interface CustomTextureState {
  textures: CustomTexture[]
  hydrated: boolean
  addFromFile: (file: File) => Promise<CustomTexture>
  remove: (id: string) => void
  clearAll: () => void
}

const MAX_NAME_LENGTH = 24

function shortName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim() || 'Texture'
  return base.length > MAX_NAME_LENGTH ? `${base.slice(0, MAX_NAME_LENGTH - 1)}…` : base
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read that image file.'))
    image.src = url
  })
}

export const useCustomTextureStore = create<CustomTextureState>((set, get) => ({
  textures: [],
  hydrated: false,

  addFromFile: async (file) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('Please choose a PNG, JPG, or WebP image.')
    }

    const objectUrl = URL.createObjectURL(file)
    try {
      const image = await loadImage(objectUrl)
      const canvas = imageToHeightMaskCanvas(image, { size: 512 })
      const id = `custom-${Date.now()}`
      registerCustomPatternCanvas(id, canvas)

      const dataUrl = canvas.toDataURL('image/png')
      const texture: CustomTexture = {
        id,
        name: shortName(file.name),
        thumbnailUrl: dataUrl,
      }

      upsertStoredCustomTexture(toStoredCustomTexture(texture, dataUrl))
      set({ textures: [texture, ...get().textures] })
      return texture
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  },

  remove: (id) => {
    unregisterCustomPatternCanvas(id)
    deleteStoredCustomTexture(id)
    set({ textures: get().textures.filter((t) => t.id !== id) })
  },

  clearAll: () => {
    for (const texture of get().textures) {
      unregisterCustomPatternCanvas(texture.id)
    }
    clearStoredCustomTextures()
    set({ textures: [] })
  },
}))

/** Restore custom textures from browser storage (call once before first render). */
export async function hydrateCustomTexturesFromStorage(): Promise<void> {
  const stored = listStoredCustomTextures()
  if (stored.length === 0) {
    useCustomTextureStore.setState({ textures: [], hydrated: true })
    return
  }

  const textures: CustomTexture[] = []
  for (const item of stored) {
    try {
      const canvas = await canvasFromDataUrl(item.dataUrl)
      registerCustomPatternCanvas(item.id, canvas)
      textures.push(toCustomTexture(item))
    } catch {
      deleteStoredCustomTexture(item.id)
    }
  }

  useCustomTextureStore.setState({ textures, hydrated: true })
}
