import { create } from 'zustand'
import type { Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import type { SelectedSurface, SelectionMode, SurfacePick } from '../types/surfaceSelection'
import {
  DEFAULT_ANGLE_TOLERANCE,
  MAX_ANGLE_TOLERANCE,
  MIN_ANGLE_TOLERANCE,
} from '../types/surfaceSelection'
import { computeFaceNormal } from '../lib/surface/computeFaceNormal'
import { computeSurfaceArea } from '../lib/surface/computeTriangleArea'
import { getConnectedCoplanarSurface } from '../lib/surface/getConnectedCoplanarSurface'
import { getAllMeshFaces, getFacesByAngle } from '../lib/surface/selectByAngle'
import { buildSelectedSurfaceGeometry } from '../lib/surface/buildSelectedSurfaceGeometry'
import { getTriangleCount } from '../lib/surface/geometryKeys'
import { getSurfaceId } from '../lib/surface/getSurfaceId'
import { clampFaceIndex, isMeshInModel } from '../lib/surface/meshUtils'
import { getMeshPatternPristineGeometry } from '../lib/materials/meshPatternRegistry'
import { mapLiveFaceIndexToPristine } from '../lib/surface/mapFaceToPristine'

interface LastPick {
  mesh: Mesh
  faceIndex: number
  point: Vector3
}

interface SurfaceSelectionState {
  enabled: boolean
  angleTolerance: number
  selectionMode: SelectionMode
  connectedOnly: boolean
  selectedSurface: SelectedSurface | null
  lastPick: LastPick | null
  modelRoot: Object3D | null

  setEnabled: (enabled: boolean) => void
  setAngleTolerance: (degrees: number) => void
  setSelectionMode: (mode: SelectionMode) => void
  setConnectedOnly: (connectedOnly: boolean) => void
  setModelRoot: (root: Object3D | null) => void
  selectFromPick: (pick: SurfacePick) => void
  recomputeFromLastPick: () => void
  clearSelection: () => void
  reset: () => void
}

function disposeHighlight(surface: SelectedSurface | null): void {
  surface?.highlightGeometry.dispose()
}

interface BuildOptions {
  angleTolerance: number
  selectionMode: SelectionMode
  connectedOnly: boolean
}

function buildSelection(
  pick: SurfacePick,
  options: BuildOptions,
  modelRoot: Object3D | null,
): SelectedSurface | null {
  const { mesh, faceIndex, point, normal } = pick
  const { angleTolerance, selectionMode, connectedOnly } = options

  if (!isMeshInModel(mesh, modelRoot)) return null

  mesh.updateWorldMatrix(true, false)

  const geometry = mesh.geometry
  const pristineGeometry = getMeshPatternPristineGeometry(mesh)
  const indexGeometry = pristineGeometry ?? geometry
  const triangleCount = getTriangleCount(indexGeometry)
  let clampedFace = clampFaceIndex(faceIndex, getTriangleCount(geometry))
  if (pristineGeometry) {
    clampedFace = mapLiveFaceIndexToPristine(mesh, pristineGeometry, clampedFace)
  } else {
    clampedFace = clampFaceIndex(clampedFace, triangleCount)
  }

  let triangleIndices: number[]
  if (selectionMode === 'part') {
    triangleIndices = getAllMeshFaces(indexGeometry)
  } else if (connectedOnly) {
    triangleIndices = getConnectedCoplanarSurface(indexGeometry, mesh, clampedFace, angleTolerance)
  } else {
    triangleIndices = getFacesByAngle(indexGeometry, mesh, clampedFace, angleTolerance)
  }

  const highlightGeometry = buildSelectedSurfaceGeometry(
    indexGeometry,
    mesh,
    triangleIndices,
    modelRoot,
  )

  if (highlightGeometry.getAttribute('position').count === 0) {
    highlightGeometry.dispose()
    return null
  }

  const area = computeSurfaceArea(indexGeometry, mesh, triangleIndices)
  const surfaceId =
    selectionMode === 'part'
      ? getSurfaceId(mesh.uuid, -1)
      : getSurfaceId(mesh.uuid, clampedFace)

  return {
    surfaceId,
    meshUuid: mesh.uuid,
    meshName: mesh.name || 'Mesh',
    faceIndex: clampedFace,
    selectionType: selectionMode,
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
  selectionMode: 'surface',
  connectedOnly: true,
  selectedSurface: null,
  lastPick: null,
  modelRoot: null,

  setEnabled: (enabled) => set({ enabled }),

  setAngleTolerance: (degrees) => {
    const clamped = Math.min(MAX_ANGLE_TOLERANCE, Math.max(MIN_ANGLE_TOLERANCE, degrees))
    set({ angleTolerance: clamped })
    get().recomputeFromLastPick()
  },

  setSelectionMode: (mode) => {
    set({ selectionMode: mode })
    get().recomputeFromLastPick()
  },

  setConnectedOnly: (connectedOnly) => {
    set({ connectedOnly })
    get().recomputeFromLastPick()
  },

  setModelRoot: (root) => set({ modelRoot: root }),

  selectFromPick: (pick) => {
    const { angleTolerance, selectionMode, connectedOnly, selectedSurface, modelRoot } = get()
    disposeHighlight(selectedSurface)

    const surface = buildSelection(
      pick,
      { angleTolerance, selectionMode, connectedOnly },
      modelRoot,
    )
    if (!surface) {
      set({ selectedSurface: null, lastPick: null })
      return
    }

    set({
      selectedSurface: surface,
      lastPick: {
        mesh: pick.mesh,
        faceIndex: pick.faceIndex,
        point: pick.point.clone(),
      },
    })
  },

  recomputeFromLastPick: () => {
    const { lastPick, angleTolerance, selectionMode, connectedOnly, selectedSurface, modelRoot } =
      get()
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
      { angleTolerance, selectionMode, connectedOnly },
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
      selectionMode: 'surface',
      connectedOnly: true,
      selectedSurface: null,
      lastPick: null,
      modelRoot: null,
    })
  },
}))
