import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Material } from 'three'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { bakeMeshRegions } from '../../lib/mesh-engine/adapters/bakeMeshRegions'
import { setCommittedRegionsHiddenForMesh } from '../../lib/materials/patternMaterialApply'
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
 * "3D Preview" — bakes every applied (committed) pattern into real,
 * extruded/embossed geometry and displays it as an overlay on top of the
 * (now-hidden) flat original surface, instead of the default 2D bump-shaded
 * preview. Overlay meshes are raycast-ignored, so only original/unpatterned
 * surfaces stay selectable while this is on — see
 * useSurfaceSelectionStore.ts's isTriangleInCommittedRegion check.
 */
export function Pattern3DPreviewOverlay() {
  const { scene } = useThree()
  const loadedModel = useAppStore((s) => s.loadedModel)
  const modelObject = loadedModel?.object ?? null
  const exportUnitScale = loadedModel?.exportUnitScale ?? 1
  const placements = usePatternStore((s) => s.placements)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)
  const show3DPreview = useBakeStore((s) => s.show3DPreview)

  const overlaysRef = useRef<Map<string, Mesh>>(new Map())
  const hiddenMeshUuidsRef = useRef<Set<string>>(new Set())

  const committedKey = useMemo(
    () =>
      committedSurfaceIds
        .map((id) => placementSignature(id, placements[id]?.settings))
        .join('|'),
    [committedSurfaceIds, placements],
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
    }
    hiddenMeshUuidsRef.current.clear()
  }

  useEffect(() => {
    if (!modelObject || !show3DPreview || committedSurfaceIds.length === 0) {
      teardown(modelObject)
      return
    }

    const meshUuids = new Set<string>()
    for (const surfaceId of committedSurfaceIds) {
      const parsed = parseSurfaceId(surfaceId)
      if (parsed) meshUuids.add(parsed.meshUuid)
    }

    let cancelled = false
    useBakeStore.getState().setShow3DPreviewBusy(true)

    void (async () => {
      const nextHidden = new Set<string>()

      for (const meshUuid of meshUuids) {
        const mesh = findMeshByUuid(modelObject, meshUuid)
        if (!mesh) continue

        const result = await bakeMeshRegions(
          mesh,
          modelObject,
          placements,
          committedSurfaceIds,
          'low',
          exportUnitScale,
          1,
        )
        if (cancelled) return
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
      }

      if (cancelled) return

      // Drop overlays for meshes that no longer have committed patterns.
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

      useBakeStore.getState().setShow3DPreviewBusy(false)
    })()

    return () => {
      cancelled = true
    }
  }, [show3DPreview, committedKey, committedSurfaceIds, modelObject, scene, placements, exportUnitScale])

  useEffect(() => {
    return () => teardown(modelObject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelObject, scene])

  return null
}
