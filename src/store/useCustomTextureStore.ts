import { create } from 'zustand'
import {
  imageToHeightMaskCanvas,
  registerCustomPatternCanvas,
  unregisterCustomPatternCanvas,
} from '../utils/patternTextures'

export interface CustomTexture {
  id: string
  name: string
  /** Data URL used for the library thumbnail. */
  thumbnailUrl: string
}

interface CustomTextureState {
  textures: CustomTexture[]
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

  addFromFile: async (file) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('Please choose a PNG, JPG, or WebP image.')
    }

    const objectUrl = URL.createObjectURL(file)
    try {
      const image = await loadImage(objectUrl)
      const canvas = imageToHeightMaskCanvas(image, { size: 256 })
      const id = `custom-${Date.now()}`
      registerCustomPatternCanvas(id, canvas)

      const texture: CustomTexture = {
        id,
        name: shortName(file.name),
        thumbnailUrl: canvas.toDataURL('image/png'),
      }
      set({ textures: [...get().textures, texture] })
      return texture
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  },

  remove: (id) => {
    unregisterCustomPatternCanvas(id)
    set({ textures: get().textures.filter((t) => t.id !== id) })
  },

  clearAll: () => {
    for (const texture of get().textures) {
      unregisterCustomPatternCanvas(texture.id)
    }
    set({ textures: [] })
  },
}))
