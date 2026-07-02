import { useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { RightPanel } from './RightPanel'
import { BottomStatusBar } from './BottomStatusBar'
import { ViewerCanvas } from '../viewer/ViewerCanvas'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { useCustomTextureStore } from '../../store/useCustomTextureStore'
import { unloadCurrentModel } from '../../lib/loaders/loadModel'

export function AppShell() {
  const loadedModel = useAppStore((s) => s.loadedModel)

  useEffect(() => {
    return () => {
      unloadCurrentModel(useAppStore.getState().loadedModel)
      useSurfaceSelectionStore.getState().reset()
      usePatternStore.getState().clearAll()
      useBakeStore.getState().resetAll()
      useCustomTextureStore.getState().clearAll()
    }
  }, [])

  useEffect(() => {
    const store = useSurfaceSelectionStore.getState()
    store.setModelRoot(loadedModel?.object ?? null)
    store.clearSelection()
    usePatternStore.getState().clearAll()
    useBakeStore.getState().resetAll()
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
