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
import { isTriangleInCommittedRegion } from '../lib/materials/patternMaterialApply'
import { mapLiveFaceIndexToPristine } from '../lib/surface/mapFaceToPristine'
import { useBakeStore } from './useBakeStore'

interface LastPick {
  mesh: Mesh
  faceIndex: number
  point: Vector3
}

interface BuildOptions {
  angleTolerance: number
  selectionMode: SelectionMode
  connectedOnly: boolean
}

interface SurfaceSelectionState {
  enabled: boolean
  angleTolerance: number
  selectionMode: SelectionMode
  connectedOnly: boolean
  /** All highlighted selections (Shift+click adds to this list). */
  selectedSurfaces: SelectedSurface[]
  /** Active surface used for pattern placement / apply (last clicked). */
  selectedSurface: SelectedSurface | null
  activeSurfaceId: string | null
  selectionSeeds: Record<string, LastPick>
  lastPick: LastPick | null
  modelRoot: Object3D | null

  setEnabled: (enabled: boolean) => void
  setAngleTolerance: (degrees: number) => void
  setSelectionMode: (mode: SelectionMode) => void
  setConnectedOnly: (connectedOnly: boolean) => void
  setModelRoot: (root: Object3D | null) => void
  selectFromPick: (pick: SurfacePick, options?: { additive?: boolean }) => void
  recomputeFromLastPick: () => void
  clearSelection: () => void
  reset: () => void
}

function disposeHighlights(surfaces: readonly SelectedSurface[]): void {
  for (const surface of surfaces) {
    surface.highlightGeometry.dispose()
  }
}

function pickSeed(pick: SurfacePick): LastPick {
  return {
    mesh: pick.mesh,
    faceIndex: pick.faceIndex,
    point: pick.point.clone(),
  }
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

  // 3D Preview mode shows applied patterns as real extruded/embossed
  // geometry via a separate overlay and hides the flat original surface
  // underneath — clicking that area should behave like clicking nothing
  // selectable, not silently re-select the hidden flat surface beneath it.
  if (useBakeStore.getState().show3DPreview && isTriangleInCommittedRegion(mesh, clampedFace)) {
    return null
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

function buildSelectionFromSeed(
  seed: LastPick,
  options: BuildOptions,
  modelRoot: Object3D | null,
): SelectedSurface | null {
  if (!isMeshInModel(seed.mesh, modelRoot)) return null

  const normal = computeFaceNormal(seed.mesh.geometry, seed.faceIndex, seed.mesh)

  return buildSelection(
    {
      mesh: seed.mesh,
      faceIndex: seed.faceIndex,
      point: seed.point,
      normal,
    },
    options,
    modelRoot,
  )
}

function commitSelectionState(
  surfaces: SelectedSurface[],
  seeds: Record<string, LastPick>,
  activeSurfaceId: string | null,
): Pick<
  SurfaceSelectionState,
  'selectedSurfaces' | 'selectedSurface' | 'activeSurfaceId' | 'selectionSeeds' | 'lastPick'
> {
  const active =
    activeSurfaceId != null
      ? surfaces.find((surface) => surface.surfaceId === activeSurfaceId) ?? null
      : null
  const lastPick =
    activeSurfaceId != null && seeds[activeSurfaceId] ? seeds[activeSurfaceId] : null

  return {
    selectedSurfaces: surfaces,
    selectedSurface: active,
    activeSurfaceId,
    selectionSeeds: seeds,
    lastPick,
  }
}

function recomputeAllSelections(state: SurfaceSelectionState): ReturnType<typeof commitSelectionState> {
  const { selectedSurfaces, selectionSeeds, activeSurfaceId, angleTolerance, selectionMode, connectedOnly, modelRoot } =
    state

  if (selectedSurfaces.length === 0) {
    return commitSelectionState([], {}, null)
  }

  const options: BuildOptions = { angleTolerance, selectionMode, connectedOnly }
  const nextSurfaces: SelectedSurface[] = []
  const nextSeeds: Record<string, LastPick> = {}

  for (const current of selectedSurfaces) {
    const seed = selectionSeeds[current.surfaceId]
    if (!seed) continue

    const rebuilt = buildSelectionFromSeed(seed, options, modelRoot)
    if (!rebuilt) continue

    current.highlightGeometry.dispose()
    nextSurfaces.push(rebuilt)
    nextSeeds[rebuilt.surfaceId] = seed
  }

  const nextActiveId =
    activeSurfaceId && nextSurfaces.some((surface) => surface.surfaceId === activeSurfaceId)
      ? activeSurfaceId
      : (nextSurfaces[nextSurfaces.length - 1]?.surfaceId ?? null)

  return commitSelectionState(nextSurfaces, nextSeeds, nextActiveId)
}

export const useSurfaceSelectionStore = create<SurfaceSelectionState>((set, get) => ({
  enabled: false,
  angleTolerance: DEFAULT_ANGLE_TOLERANCE,
  selectionMode: 'surface',
  connectedOnly: true,
  selectedSurfaces: [],
  selectedSurface: null,
  activeSurfaceId: null,
  selectionSeeds: {},
  lastPick: null,
  modelRoot: null,

  setEnabled: (enabled) => set({ enabled }),

  setAngleTolerance: (degrees) => {
    const clamped = Math.min(MAX_ANGLE_TOLERANCE, Math.max(MIN_ANGLE_TOLERANCE, degrees))
    set({ angleTolerance: clamped })
    set(recomputeAllSelections(get()))
  },

  setSelectionMode: (mode) => {
    set({ selectionMode: mode })
    set(recomputeAllSelections(get()))
  },

  setConnectedOnly: (connectedOnly) => {
    set({ connectedOnly })
    set(recomputeAllSelections(get()))
  },

  setModelRoot: (root) => set({ modelRoot: root }),

  selectFromPick: (pick, options) => {
    const additive = options?.additive ?? false
    const { angleTolerance, selectionMode, connectedOnly, selectedSurfaces, selectionSeeds, modelRoot } =
      get()

    const surface = buildSelection(
      pick,
      { angleTolerance, selectionMode, connectedOnly },
      modelRoot,
    )

    if (!surface) {
      if (!additive) {
        disposeHighlights(selectedSurfaces)
        set(commitSelectionState([], {}, null))
      }
      return
    }

    const seed = pickSeed(pick)
    const existingIndex = selectedSurfaces.findIndex((item) => item.surfaceId === surface.surfaceId)

    if (additive && existingIndex >= 0) {
      const removed = selectedSurfaces[existingIndex]!
      removed.highlightGeometry.dispose()
      const nextSurfaces = selectedSurfaces.filter((_, index) => index !== existingIndex)
      const nextSeeds = { ...selectionSeeds }
      delete nextSeeds[surface.surfaceId]

      const wasActive = get().activeSurfaceId === surface.surfaceId
      const nextActiveId = wasActive
        ? (nextSurfaces[nextSurfaces.length - 1]?.surfaceId ?? null)
        : get().activeSurfaceId

      set(commitSelectionState(nextSurfaces, nextSeeds, nextActiveId))
      return
    }

    if (additive) {
      set(
        commitSelectionState(
          [...selectedSurfaces, surface],
          { ...selectionSeeds, [surface.surfaceId]: seed },
          surface.surfaceId,
        ),
      )
      return
    }

    disposeHighlights(selectedSurfaces)
    set(
      commitSelectionState([surface], { [surface.surfaceId]: seed }, surface.surfaceId),
    )
  },

  recomputeFromLastPick: () => {
    set(recomputeAllSelections(get()))
  },

  clearSelection: () => {
    const { selectedSurfaces } = get()
    disposeHighlights(selectedSurfaces)
    set(commitSelectionState([], {}, null))
  },

  reset: () => {
    const { selectedSurfaces } = get()
    disposeHighlights(selectedSurfaces)
    set({
      enabled: false,
      angleTolerance: DEFAULT_ANGLE_TOLERANCE,
      selectionMode: 'surface',
      connectedOnly: true,
      selectedSurfaces: [],
      selectedSurface: null,
      activeSurfaceId: null,
      selectionSeeds: {},
      lastPick: null,
      modelRoot: null,
    })
  },
}))
