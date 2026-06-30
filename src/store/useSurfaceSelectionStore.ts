import { create } from 'zustand'
import type { Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import type { SelectedSurface, SurfacePick } from '../types/surfaceSelection'
import { DEFAULT_ANGLE_TOLERANCE } from '../types/surfaceSelection'
import { computeFaceNormal } from '../lib/surface/computeFaceNormal'
import { computeSurfaceArea } from '../lib/surface/computeTriangleArea'
import { getConnectedCoplanarSurface } from '../lib/surface/getConnectedCoplanarSurface'
import { buildSelectedSurfaceGeometry } from '../lib/surface/buildSelectedSurfaceGeometry'
import { getTriangleCount } from '../lib/surface/geometryKeys'
import { getSurfaceId } from '../lib/surface/getSurfaceId'
import { clampFaceIndex, isMeshInModel } from '../lib/surface/meshUtils'

interface LastPick {
  mesh: Mesh
  faceIndex: number
  point: Vector3
}

interface SurfaceSelectionState {
  enabled: boolean
  angleTolerance: number
  selectedSurface: SelectedSurface | null
  lastPick: LastPick | null
  modelRoot: Object3D | null

  setEnabled: (enabled: boolean) => void
  setAngleTolerance: (degrees: number) => void
  setModelRoot: (root: Object3D | null) => void
  selectFromPick: (pick: SurfacePick) => void
  recomputeFromLastPick: () => void
  clearSelection: () => void
  reset: () => void
}

function disposeHighlight(surface: SelectedSurface | null): void {
  surface?.highlightGeometry.dispose()
}

function buildSelection(
  pick: SurfacePick,
  angleTolerance: number,
  modelRoot: Object3D | null,
): SelectedSurface | null {
  const { mesh, faceIndex, point, normal } = pick

  if (!isMeshInModel(mesh, modelRoot)) return null

  mesh.updateWorldMatrix(true, false)

  const geometry = mesh.geometry
  const triangleCount = getTriangleCount(geometry)
  const clampedFace = clampFaceIndex(faceIndex, triangleCount)

  const triangleIndices = getConnectedCoplanarSurface(
    geometry,
    mesh,
    clampedFace,
    angleTolerance,
  )

  const highlightGeometry = buildSelectedSurfaceGeometry(
    geometry,
    mesh,
    triangleIndices,
    modelRoot,
  )

  if (highlightGeometry.getAttribute('position').count === 0) {
    highlightGeometry.dispose()
    return null
  }

  const area = computeSurfaceArea(geometry, mesh, triangleIndices)

  return {
    surfaceId: getSurfaceId(mesh.uuid, clampedFace),
    meshUuid: mesh.uuid,
    meshName: mesh.name || 'Mesh',
    faceIndex: clampedFace,
    point: point.clone(),
    normal: normal.clone(),
    triangleIndices,
    triangleCount: triangleIndices.length,
    area,
    highlightGeometry,
  }
}

export const useSurfaceSelectionStore = create<SurfaceSelectionState>((set, get) => ({
  enabled: false,
  angleTolerance: DEFAULT_ANGLE_TOLERANCE,
  selectedSurface: null,
  lastPick: null,
  modelRoot: null,

  setEnabled: (enabled) => set({ enabled }),

  setAngleTolerance: (degrees) => {
    const clamped = Math.min(45, Math.max(1, degrees))
    set({ angleTolerance: clamped })
    get().recomputeFromLastPick()
  },

  setModelRoot: (root) => set({ modelRoot: root }),

  selectFromPick: (pick) => {
    const { angleTolerance, selectedSurface, modelRoot } = get()
    disposeHighlight(selectedSurface)

    const surface = buildSelection(pick, angleTolerance, modelRoot)
    if (!surface) {
      set({ selectedSurface: null, lastPick: null })
      return
    }

    set({
      selectedSurface: surface,
      lastPick: {
        mesh: pick.mesh,
        faceIndex: surface.faceIndex,
        point: pick.point.clone(),
      },
    })
  },

  recomputeFromLastPick: () => {
    const { lastPick, angleTolerance, selectedSurface, modelRoot } = get()
    if (!lastPick || !isMeshInModel(lastPick.mesh, modelRoot)) {
      disposeHighlight(selectedSurface)
      set({ selectedSurface: null, lastPick: null })
      return
    }

    disposeHighlight(selectedSurface)

    const normal = computeFaceNormal(
      lastPick.mesh.geometry,
      lastPick.faceIndex,
      lastPick.mesh,
    )

    const surface = buildSelection(
      {
        mesh: lastPick.mesh,
        faceIndex: lastPick.faceIndex,
        point: lastPick.point,
        normal,
      },
      angleTolerance,
      modelRoot,
    )

    set({ selectedSurface: surface })
  },

  clearSelection: () => {
    const { selectedSurface } = get()
    disposeHighlight(selectedSurface)
    set({ selectedSurface: null, lastPick: null })
  },

  reset: () => {
    const { selectedSurface } = get()
    disposeHighlight(selectedSurface)
    set({
      enabled: false,
      angleTolerance: DEFAULT_ANGLE_TOLERANCE,
      selectedSurface: null,
      lastPick: null,
      modelRoot: null,
    })
  },
}))
