import { useBakeStore } from '../../store/useBakeStore'

/** Renders baked geometry in the scene after a successful bake. */
export function BakedPatchesOverlay() {
  const bakedObject = useBakeStore((s) => s.bakedObject)
  const showBakedInScene = useBakeStore((s) => s.showBakedInScene)

  if (!bakedObject || !showBakedInScene) return null

  return <primitive object={bakedObject} dispose={null} />
}
