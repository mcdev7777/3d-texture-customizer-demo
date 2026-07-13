import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, MeshStandardMaterial, type Material } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { buildRegionPreviewOverlays } from '../../lib/mesh-engine/adapters/buildRegionPreviewOverlays'
import { MAX_EXPORT_QUALITY } from '../../types/bake'
import {
  setCommittedRegionsHiddenForMesh,
  setPreviewRegionsHiddenForMesh,
} from '../../lib/materials/patternMaterialApply'
import { findMeshByUuid, parseSurfaceId } from '../../lib/surface/restoreSurfaceFromId'
import { markIgnoreRaycast } from '../../lib/three/raycastUtils'
import type { SurfacePatternSettings } from '../../types/pattern'

function placementSignature(surfaceId: string, settings: SurfacePatternSettings | undefined): string {
  if (!settings?.patternId) return `${surfaceId}:`
  return [surfaceId, ...Object.values(settings)].join(':')
}

function resolveMaterial(material: Material | Material[]): Material {
  return Array.isArray(material) ? (material.find(Boolean) ?? new MeshStandardMaterial()) : material
}

/**
 * "3D Preview" — projects every applied (committed) pattern, plus any selected
 * surface that has a pattern chosen but not yet applied, onto the surface as a
 * GPU-shaded overlay (bump/displacement in a shader) on top of the (now-hidden)
 * flat original surface.
 *
 * This is the fast path ported from BumpMesh: rather than running the full CPU
 * mesh pipeline (subdivide → displace → decimate → repair) on every pattern
 * tweak — which took seconds — the pattern is projected and bump-shaded
 * entirely on the GPU, so the preview updates in a single frame. The export
 * bake still uses the real geometry pipeline; only the live preview is
 * shader-based. See buildRegionPreviewOverlays / patternPreviewShaderMaterial.
 *
 * Overlay meshes are raycast-ignored and the flat regions they cover are
 * hidden, so only original/unpatterned surfaces stay selectable while this is
 * on — see useSurfaceSelectionStore.ts's isTriangleInHiddenPreviewRegion check.
 */
export function Pattern3DPreviewOverlay() {
  const { scene } = useThree()
  const loadedModel = useAppStore((s) => s.loadedModel)
  const modelObject = loadedModel?.object ?? null
  const exportUnitScale = loadedModel?.exportUnitScale ?? 1
  const placements = usePatternStore((s) => s.placements)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)
  const show3DPreview = useBakeStore((s) => s.show3DPreview)
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)

  const previewSurfaceIds = useMemo(() => {
    const committed = new Set(committedSurfaceIds)
    return selectedSurfaces
      .map((s) => s.surfaceId)
      .filter((id) => !committed.has(id) && !!placements[id]?.settings.patternId)
  }, [selectedSurfaces, committedSurfaceIds, placements])

  // One mesh can carry several patterned regions, so each mesh maps to a list
  // of shader overlay meshes.
  const overlaysRef = useRef<Map<string, Mesh[]>>(new Map())
  const hiddenMeshUuidsRef = useRef<Set<string>>(new Set())
  const hiddenPreviewMeshUuidsRef = useRef<Set<string>>(new Set())

  const committedKey = useMemo(
    () =>
      [...committedSurfaceIds, ...previewSurfaceIds]
        .map((id) => placementSignature(id, placements[id]?.settings))
        .join('|'),
    [committedSurfaceIds, previewSurfaceIds, placements],
  )

  function disposeOverlay(overlay: Mesh) {
    scene.remove(overlay)
    overlay.geometry.dispose()
    const mat = overlay.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
  }

  function teardown(root: typeof modelObject) {
    for (const overlays of overlaysRef.current.values()) {
      for (const overlay of overlays) disposeOverlay(overlay)
    }
    overlaysRef.current.clear()

    if (root) {
      for (const meshUuid of hiddenMeshUuidsRef.current) {
        setCommittedRegionsHiddenForMesh(root, meshUuid, false)
      }
      for (const meshUuid of hiddenPreviewMeshUuidsRef.current) {
        setPreviewRegionsHiddenForMesh(root, meshUuid, [])
      }
    }
    hiddenMeshUuidsRef.current.clear()
    hiddenPreviewMeshUuidsRef.current.clear()
  }

  useEffect(() => {
    const allSurfaceIds = [...committedSurfaceIds, ...previewSurfaceIds]
    if (!modelObject || !show3DPreview || allSurfaceIds.length === 0) {
      teardown(modelObject)
      return
    }

    const meshUuids = new Set<string>()
    for (const surfaceId of allSurfaceIds) {
      const parsed = parseSurfaceId(surfaceId)
      if (parsed) meshUuids.add(parsed.meshUuid)
    }

    const previewIdsByMesh = new Map<string, string[]>()
    for (const surfaceId of previewSurfaceIds) {
      const parsed = parseSurfaceId(surfaceId)
      if (!parsed) continue
      const list = previewIdsByMesh.get(parsed.meshUuid) ?? []
      list.push(surfaceId)
      previewIdsByMesh.set(parsed.meshUuid, list)
    }

    useBakeStore.getState().setShow3DPreviewBusy(true)

    const nextHidden = new Set<string>()
    const nextHiddenPreview = new Set<string>()

    for (const meshUuid of meshUuids) {
      const mesh = findMeshByUuid(modelObject, meshUuid)
      if (!mesh) continue

      const meshPreviewIds = previewIdsByMesh.get(meshUuid) ?? []
      const sourceMaterial = resolveMaterial(mesh.material)

      // Max quality — this is how users judge print fidelity while still
      // choosing a pattern. The shader path is cheap regardless of quality;
      // quality here only controls the displacement texture resolution.
      const specs = buildRegionPreviewOverlays(
        mesh,
        modelObject,
        placements,
        committedSurfaceIds,
        MAX_EXPORT_QUALITY,
        exportUnitScale,
        1,
        sourceMaterial,
        meshPreviewIds,
      )

      // Replace any previous overlays for this mesh.
      const prev = overlaysRef.current.get(meshUuid)
      if (prev) for (const o of prev) disposeOverlay(o)

      if (specs.length === 0) {
        overlaysRef.current.delete(meshUuid)
        continue
      }

      const overlays: Mesh[] = specs.map(({ geometry, material }) => {
        const overlay = new Mesh(geometry, material)
        overlay.frustumCulled = false
        markIgnoreRaycast(overlay)
        scene.add(overlay)
        return overlay
      })
      overlaysRef.current.set(meshUuid, overlays)

      setCommittedRegionsHiddenForMesh(modelObject, meshUuid, true)
      nextHidden.add(meshUuid)

      if (meshPreviewIds.length > 0) {
        setPreviewRegionsHiddenForMesh(modelObject, meshUuid, meshPreviewIds)
        nextHiddenPreview.add(meshUuid)
      }
    }

    // Drop overlays for meshes that no longer have committed/previewed patterns.
    for (const [meshUuid, overlays] of overlaysRef.current) {
      if (meshUuids.has(meshUuid)) continue
      for (const o of overlays) disposeOverlay(o)
      overlaysRef.current.delete(meshUuid)
    }
    for (const meshUuid of hiddenMeshUuidsRef.current) {
      if (!nextHidden.has(meshUuid)) setCommittedRegionsHiddenForMesh(modelObject, meshUuid, false)
    }
    hiddenMeshUuidsRef.current = nextHidden

    for (const meshUuid of hiddenPreviewMeshUuidsRef.current) {
      if (!nextHiddenPreview.has(meshUuid)) setPreviewRegionsHiddenForMesh(modelObject, meshUuid, [])
    }
    hiddenPreviewMeshUuidsRef.current = nextHiddenPreview

    useBakeStore.getState().setShow3DPreviewBusy(false)
  }, [
    show3DPreview,
    committedKey,
    committedSurfaceIds,
    previewSurfaceIds,
    modelObject,
    scene,
    placements,
    exportUnitScale,
  ])

  useEffect(() => {
    return () => teardown(modelObject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelObject, scene])

  return null
}
