import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Material } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { bakeMeshRegions } from '../../lib/mesh-engine/adapters/bakeMeshRegions'
import {
  setCommittedRegionsHiddenForMesh,
  setPreviewRegionsHiddenForMesh,
} from '../../lib/materials/patternMaterialApply'
import { extractBaseColor } from '../../lib/materials/extractBaseColor'
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
 * "3D Preview" — bakes every applied (committed) pattern, plus any selected
 * surface that has a pattern chosen but not yet applied, into real,
 * extruded/embossed geometry and displays it as an overlay on top of the
 * (now-hidden) flat original surface, instead of the default 2D bump-shaded
 * preview. This lets users compare 2D vs 3D preview at any point a pattern is
 * selected, not just after "Apply texture." Overlay meshes are
 * raycast-ignored, and the flat regions they cover are hidden, so only
 * original/unpatterned surfaces stay selectable while this is on — see
 * useSurfaceSelectionStore.ts's isTriangleInHiddenPreviewRegion check.
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

  const overlaysRef = useRef<Map<string, Mesh>>(new Map())
  const hiddenMeshUuidsRef = useRef<Set<string>>(new Set())
  const hiddenPreviewMeshUuidsRef = useRef<Set<string>>(new Set())

  const committedKey = useMemo(
    () =>
      [...committedSurfaceIds, ...previewSurfaceIds]
        .map((id) => placementSignature(id, placements[id]?.settings))
        .join('|'),
    [committedSurfaceIds, previewSurfaceIds, placements],
  )

  function teardown(root: typeof modelObject) {
    for (const overlay of overlaysRef.current.values()) {
      scene.remove(overlay)
      overlay.geometry.dispose()
      const mat = overlay.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
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

    let cancelled = false
    useBakeStore.getState().setShow3DPreviewBusy(true)

    const previewIdsByMesh = new Map<string, string[]>()
    for (const surfaceId of previewSurfaceIds) {
      const parsed = parseSurfaceId(surfaceId)
      if (!parsed) continue
      const list = previewIdsByMesh.get(parsed.meshUuid) ?? []
      list.push(surfaceId)
      previewIdsByMesh.set(parsed.meshUuid, list)
    }

    // If this pass is cancelled mid-flight, undo any hides it already
    // applied that weren't already hidden before this pass started —
    // otherwise a superseded run can leave a mesh's flat region hidden
    // forever with no overlay to replace it (the part "disappears" until
    // some later, uncancelled run happens to reconcile it — e.g. toggling
    // back to 2D and forcing a fresh render).
    function revertPartialHides(root: NonNullable<typeof modelObject>, nextHidden: Set<string>, nextHiddenPreview: Set<string>) {
      for (const meshUuid of nextHidden) {
        if (!hiddenMeshUuidsRef.current.has(meshUuid)) {
          setCommittedRegionsHiddenForMesh(root, meshUuid, false)
        }
      }
      for (const meshUuid of nextHiddenPreview) {
        if (!hiddenPreviewMeshUuidsRef.current.has(meshUuid)) {
          setPreviewRegionsHiddenForMesh(root, meshUuid, [])
        }
      }
    }

    void (async () => {
      const nextHidden = new Set<string>()
      const nextHiddenPreview = new Set<string>()

      for (const meshUuid of meshUuids) {
        const mesh = findMeshByUuid(modelObject, meshUuid)
        if (!mesh) continue

        const meshPreviewIds = previewIdsByMesh.get(meshUuid) ?? []

        // 'high' quality — this is how users judge print fidelity while
        // still choosing a pattern, so it must look right, not like a
        // cheaper approximation. Export's own quality selector (Low/Medium/
        // High) is separate and untouched — this only affects the preview
        // overlay's own bake.
        const result = await bakeMeshRegions(
          mesh,
          modelObject,
          placements,
          committedSurfaceIds,
          'high',
          exportUnitScale,
          1,
          undefined,
          undefined,
          meshPreviewIds,
        )
        if (cancelled) {
          revertPartialHides(modelObject, nextHidden, nextHiddenPreview)
          return
        }
        if (!result || !result.normals) continue

        let overlay = overlaysRef.current.get(meshUuid)
        if (!overlay) {
          const material = new MeshStandardMaterial()
          overlay = new Mesh(new BufferGeometry(), material)
          overlay.frustumCulled = false
          markIgnoreRaycast(overlay)
          scene.add(overlay)
          overlaysRef.current.set(meshUuid, overlay)
        }

        const base = extractBaseColor(resolveMaterial(mesh.material))
        ;(overlay.material as MeshStandardMaterial).color.copy(base)

        const oldGeo = overlay.geometry
        const geo = new BufferGeometry()
        geo.setAttribute('position', new BufferAttribute(result.positions, 3))
        geo.setAttribute('normal', new BufferAttribute(result.normals, 3))
        overlay.geometry = geo
        oldGeo.dispose()

        setCommittedRegionsHiddenForMesh(modelObject, meshUuid, true)
        nextHidden.add(meshUuid)

        if (meshPreviewIds.length > 0) {
          setPreviewRegionsHiddenForMesh(modelObject, meshUuid, meshPreviewIds)
          nextHiddenPreview.add(meshUuid)
        }
      }

      if (cancelled) {
        revertPartialHides(modelObject, nextHidden, nextHiddenPreview)
        return
      }

      // Drop overlays for meshes that no longer have committed/previewed patterns.
      for (const [meshUuid, overlay] of overlaysRef.current) {
        if (meshUuids.has(meshUuid)) continue
        scene.remove(overlay)
        overlay.geometry.dispose()
        const mat = overlay.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
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
    })()

    return () => {
      cancelled = true
    }
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
