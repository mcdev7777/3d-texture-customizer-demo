import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { RightPanel } from './RightPanel'
import { BottomStatusBar } from './BottomStatusBar'
import { ViewerCanvas } from '../viewer/ViewerCanvas'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { unloadCurrentModel } from '../../lib/loaders/loadModel'

export function AppShell() {
  const loadedModel = useAppStore((s) => s.loadedModel)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)

  useEffect(() => {
    return () => {
      unloadCurrentModel(useAppStore.getState().loadedModel)
      useSurfaceSelectionStore.getState().reset()
      usePatternStore.getState().clearAll()
      useBakeStore.getState().clearBake()
    }
  }, [])

  useEffect(() => {
    const store = useSurfaceSelectionStore.getState()
    store.setModelRoot(loadedModel?.object ?? null)
    store.clearSelection()
    usePatternStore.getState().clearAll()
    useBakeStore.getState().clearBake()
  }, [loadedModel?.object.uuid])

  useEffect(() => {
    let prevPlacements = usePatternStore.getState().placements
    return usePatternStore.subscribe((state) => {
      if (state.placements === prevPlacements) return
      prevPlacements = state.placements
      useBakeStore.getState().markPending()
    })
  }, [])

  useEffect(() => {
    if (selectedSurface) {
      usePatternStore.getState().syncSurfacePlane(selectedSurface)
    }
  }, [
    selectedSurface?.surfaceId,
    selectedSurface?.triangleCount,
    selectedSurface?.area,
  ])

  return (
    <div className="app-gradient-bg h-full flex flex-col p-2 sm:p-3 gap-2 sm:gap-3 min-h-0">
      <div className="flex flex-col lg:flex-row flex-1 gap-2 sm:gap-3 min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <ViewerCanvas />
        </main>
        <RightPanel />
      </div>
      <BottomStatusBar />
    </div>
  )
}
