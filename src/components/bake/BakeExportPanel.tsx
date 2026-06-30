import { useState } from 'react'
import { Download, Hammer, Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import type { ExportFormat } from '../../types/bake'

const FORMAT_NOTES: Record<ExportFormat, string> = {
  glb: 'GLB includes geometry and texture/material.',
  stl: 'STL exports geometry only.',
  obj: 'OBJ exports geometry only.',
}

export function BakeExportPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const placements = usePatternStore((s) => s.placements)
  const hasPattern = Object.values(placements).some((p) => p.settings.patternId)

  const status = useBakeStore((s) => s.status)
  const error = useBakeStore((s) => s.error)
  const warnings = useBakeStore((s) => s.warnings)
  const previewActive = useBakeStore((s) => s.previewActive)
  const showBakedInScene = useBakeStore((s) => s.showBakedInScene)
  const bake = useBakeStore((s) => s.bake)
  const exportModel = useBakeStore((s) => s.exportModel)
  const setPreviewActive = useBakeStore((s) => s.setPreviewActive)
  const setShowBakedInScene = useBakeStore((s) => s.setShowBakedInScene)
  const clearBake = useBakeStore((s) => s.clearBake)

  const [format, setFormat] = useState<ExportFormat>('glb')
  const isBusy = status === 'baking' || status === 'exporting' || status === 'preparing'
  const isApplied = status === 'export-ready' || status === 'complete'

  const statusText = isBusy
    ? status === 'baking'
      ? 'Applying geometry…'
      : 'Exporting…'
    : isApplied
      ? 'Applied — real geometry ready'
      : status === 'error'
        ? 'Error'
        : previewActive && hasPattern
          ? 'Preview active'
          : hasPattern
            ? 'Ready to preview'
            : 'Choose a texture'

  return (
    <Panel title="Apply Texture" id="texture-panel">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          {isApplied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : status === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          ) : isBusy ? (
            <Loader2 className="h-3.5 w-3.5 text-purple-400 loading-spinner shrink-0" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-purple-500/60 shrink-0" />
          )}
          <span className="text-slate-300">{statusText}</span>
        </div>

        {!selectedSurface && hasModel && (
          <p className="text-[11px] text-amber-400/90">Select a surface or part first.</p>
        )}
        {selectedSurface && !hasPattern && (
          <p className="text-[11px] text-amber-400/90">Choose a texture from the library.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={previewActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            disabled={!hasPattern || isBusy}
            onClick={() => setPreviewActive(!previewActive)}
            className="text-xs"
          >
            {previewActive ? 'Reset preview' : 'Preview'}
          </Button>
          <Button
            icon={
              isBusy && status === 'baking' ? (
                <Loader2 className="h-3.5 w-3.5 loading-spinner" />
              ) : (
                <Hammer className="h-3.5 w-3.5" />
              )
            }
            disabled={!hasPattern || isBusy}
            onClick={() => void bake()}
            className="text-xs"
            variant="primary"
          >
            Apply texture
          </Button>
        </div>

        <p className="text-[10px] text-slate-500">
          Apply converts the texture into real printable mesh geometry. Emboss raises the surface,
          engrave recesses it.
        </p>

        {isApplied && (
          <div className="space-y-2 pt-2 border-t border-purple-500/10">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showBakedInScene}
                onChange={(e) => setShowBakedInScene(e.target.checked)}
                className="accent-purple-500"
              />
              Show applied geometry
            </label>

            <div className="space-y-1.5">
              <div className="flex gap-2">
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                  className="flex-1 min-w-0 rounded-lg border border-purple-500/20 bg-navy-900/80 px-2 py-1.5 text-xs text-slate-200"
                >
                  <option value="glb">GLB</option>
                  <option value="stl">STL</option>
                  <option value="obj">OBJ</option>
                </select>
                <Button
                  icon={
                    isBusy && status === 'exporting' ? (
                      <Loader2 className="h-3.5 w-3.5 loading-spinner" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )
                  }
                  disabled={isBusy}
                  onClick={() => void exportModel(format)}
                  className="text-xs px-2 shrink-0"
                >
                  Export
                </Button>
              </div>
              <p className="text-[10px] text-slate-500">{FORMAT_NOTES[format]}</p>
            </div>

            <Button
              disabled={isBusy}
              onClick={clearBake}
              className="w-full text-xs"
              variant="ghost"
            >
              Clear applied geometry
            </Button>
          </div>
        )}

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
