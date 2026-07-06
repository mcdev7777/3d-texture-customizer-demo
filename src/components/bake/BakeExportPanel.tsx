import { Hammer, Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'

export function BakeExportPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)
  const selectionCount = selectedSurfaces.length
  const placements = usePatternStore((s) => s.placements)

  const status = useBakeStore((s) => s.status)
  const error = useBakeStore((s) => s.error)
  const warnings = useBakeStore((s) => s.warnings)
  const previewActive = useBakeStore((s) => s.previewActive)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)
  const applyTexture = useBakeStore((s) => s.applyTexture)
  const setPreviewActive = useBakeStore((s) => s.setPreviewActive)
  const resetAll = useBakeStore((s) => s.resetAll)

  const selectedPlacement = selectedSurface ? placements[selectedSurface.surfaceId] : undefined
  const selectedHasPattern = !!selectedPlacement?.settings.patternId
  const appliedCount = committedSurfaceIds.length
  const hasApplied = appliedCount > 0

  const isBusy = status === 'applying'

  const statusText = isBusy
    ? status === 'applying'
      ? 'Applying texture…'
      : 'Working…'
    : status === 'error'
      ? 'Error'
      : previewActive && selectedHasPattern
        ? 'Preview active'
        : hasApplied
          ? `${appliedCount} surface${appliedCount === 1 ? '' : 's'} textured`
          : selectedHasPattern
            ? 'Ready to apply'
            : 'Choose a texture'

  const handleResetOriginal = () => {
    usePatternStore.getState().clearAll()
    useSurfaceSelectionStore.getState().clearSelection()
    resetAll()
  }

  return (
    <Panel title="Apply Texture" id="texture-panel">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          {isBusy ? (
            <Loader2 className="h-3.5 w-3.5 text-purple-400 loading-spinner shrink-0" />
          ) : status === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          ) : hasApplied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-purple-500/60 shrink-0" />
          )}
          <span className="text-slate-300">{statusText}</span>
        </div>

        {!selectedSurface && hasModel && (
          <p className="text-[11px] text-amber-400/90">Select a surface or part first.</p>
        )}
        {selectedSurface && !selectedHasPattern && (
          <p className="text-[11px] text-amber-400/90">Choose a texture from the library.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={previewActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            disabled={!selectedHasPattern || isBusy}
            onClick={() => setPreviewActive(!previewActive)}
            className="text-xs"
          >
            {previewActive ? 'Hide preview' : 'Preview'}
          </Button>
          <Button
            icon={
              status === 'applying' ? (
                <Loader2 className="h-3.5 w-3.5 loading-spinner" />
              ) : (
                <Hammer className="h-3.5 w-3.5" />
              )
            }
            disabled={!selectedHasPattern || isBusy}
            onClick={() => void applyTexture()}
            className="text-xs"
            variant="primary"
          >
            Apply texture
          </Button>
        </div>

        <p className="text-[10px] text-slate-500">
          Apply adds bump-map shading — the surface color stays the same; pattern detail
          comes from shadows and highlights. Depth controls relief strength.
          {selectionCount > 1
            ? ` Applies to all ${selectionCount} selected regions at once.`
            : ' Part mode maps all faces; surface mode maps the selected face only.'}
        </p>

        <div className="pt-2 border-t border-purple-500/10">
          <Button
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            disabled={(!hasApplied && !selectedSurface) || isBusy}
            onClick={handleResetOriginal}
            className="w-full text-xs"
            variant="ghost"
          >
            Reset to original
          </Button>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        {warnings.length > 0 && (
          <ul className="text-[10px] text-amber-400/90 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
