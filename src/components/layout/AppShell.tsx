import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { RightPanel } from './RightPanel'
import { BottomStatusBar } from './BottomStatusBar'
import { ViewerCanvas } from '../viewer/ViewerCanvas'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePartTransformStore } from '../../store/usePartTransformStore'
import { teardownLoadedModel } from '../../lib/model/teardownModel'

export function AppShell() {
  const loadedModel = useAppStore((s) => s.loadedModel)

  useEffect(() => {
    return () => {
      teardownLoadedModel(useAppStore.getState().loadedModel)
      useSurfaceSelectionStore.getState().reset()
      usePartTransformStore.getState().clear()
    }
  }, [])

  useEffect(() => {
    useSurfaceSelectionStore.getState().setModelRoot(loadedModel?.object ?? null)
    usePartTransformStore.getState().clear()
  }, [loadedModel?.object.uuid])

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
