import { create } from 'zustand'
import { MathUtils, type Mesh } from 'three'
import { useSurfaceSelectionStore } from './useSurfaceSelectionStore'

export type Axis = 'x' | 'y' | 'z'

interface PartTransformEntry {
  baseRotationRad: [number, number, number]
  baseScale: [number, number, number]
  rotationDeltaDeg: Record<Axis, number>
  scaleMultiplier: number
}

interface PartTransformState {
  entries: Record<string, PartTransformEntry>
  setRotation: (mesh: Mesh, axis: Axis, degrees: number) => void
  setScale: (mesh: Mesh, multiplier: number) => void
  resetPart: (mesh: Mesh) => void
  clear: () => void
  getEntry: (meshUuid: string) => PartTransformEntry | null
}

function captureBase(mesh: Mesh): PartTransformEntry {
  return {
    baseRotationRad: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    baseScale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    rotationDeltaDeg: { x: 0, y: 0, z: 0 },
    scaleMultiplier: 1,
  }
}

function applyEntry(mesh: Mesh, entry: PartTransformEntry): void {
  mesh.rotation.set(
    entry.baseRotationRad[0] + MathUtils.degToRad(entry.rotationDeltaDeg.x),
    entry.baseRotationRad[1] + MathUtils.degToRad(entry.rotationDeltaDeg.y),
    entry.baseRotationRad[2] + MathUtils.degToRad(entry.rotationDeltaDeg.z),
  )
  mesh.scale.set(
    entry.baseScale[0] * entry.scaleMultiplier,
    entry.baseScale[1] * entry.scaleMultiplier,
    entry.baseScale[2] * entry.scaleMultiplier,
  )
  mesh.updateMatrixWorld(true)
  useSurfaceSelectionStore.getState().recomputeFromLastPick()
}

export const usePartTransformStore = create<PartTransformState>((set, get) => ({
  entries: {},

  setRotation: (mesh, axis, degrees) => {
    const entry = get().entries[mesh.uuid] ?? captureBase(mesh)
    const clamped = Math.min(360, Math.max(0, degrees))
    const nextEntry: PartTransformEntry = {
      ...entry,
      rotationDeltaDeg: { ...entry.rotationDeltaDeg, [axis]: clamped },
    }
    applyEntry(mesh, nextEntry)
    set((state) => ({ entries: { ...state.entries, [mesh.uuid]: nextEntry } }))
  },

  setScale: (mesh, multiplier) => {
    const entry = get().entries[mesh.uuid] ?? captureBase(mesh)
    const clamped = Math.min(4, Math.max(0.1, multiplier))
    const nextEntry: PartTransformEntry = { ...entry, scaleMultiplier: clamped }
    applyEntry(mesh, nextEntry)
    set((state) => ({ entries: { ...state.entries, [mesh.uuid]: nextEntry } }))
  },

  resetPart: (mesh) => {
    const entry = get().entries[mesh.uuid]
    if (!entry) return
    const resetEntry: PartTransformEntry = {
      ...entry,
      rotationDeltaDeg: { x: 0, y: 0, z: 0 },
      scaleMultiplier: 1,
    }
    applyEntry(mesh, resetEntry)
    set((state) => {
      const next = { ...state.entries }
      delete next[mesh.uuid]
      return { entries: next }
    })
  },

  clear: () => set({ entries: {} }),

  getEntry: (meshUuid) => get().entries[meshUuid] ?? null,
}))
