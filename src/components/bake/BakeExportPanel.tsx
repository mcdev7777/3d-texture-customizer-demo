import { useState } from 'react'
import { Download, Hammer, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import type { ExportFormat } from '../../types/bake'

const FORMAT_NOTES: Record<ExportFormat, string> = {
  glb: 'GLB includes geometry and texture/material preview.',
  stl: 'STL exports geometry only.',
  obj: 'OBJ exports geometry only in this demo.',
}

function statusLabel(status: ReturnType<typeof useBakeStore.getState>['status']): string {
  switch (status) {
    case 'idle':
      return 'No pattern applied'
    case 'preview':
      return 'Preview only'
    case 'bake-pending':
      return 'Bake pending — settings changed'
    case 'baking':
      return 'Baking geometry…'
    case 'preparing':
      return 'Preparing export…'
    case 'baked':
    case 'export-ready':
      return 'Baked geometry ready'
    case 'exporting':
      return 'Exporting…'
    case 'complete':
      return 'Export complete'
    case 'error':
      return 'Error'
    default:
      return status
  }
}

export function BakeExportPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const placements = usePatternStore((s) => s.placements)
  const hasPattern = Object.values(placements).some((p) => p.settings.patternId)

  const status = useBakeStore((s) => s.status)
  const error = useBakeStore((s) => s.error)
  const warnings = useBakeStore((s) => s.warnings)
  const segmentCount = useBakeStore((s) => s.segmentCount)
  const showBakedInScene = useBakeStore((s) => s.showBakedInScene)
  const bake = useBakeStore((s) => s.bake)
  const exportModel = useBakeStore((s) => s.exportModel)
  const setSegmentCount = useBakeStore((s) => s.setSegmentCount)
  const setShowBakedInScene = useBakeStore((s) => s.setShowBakedInScene)
  const clearBake = useBakeStore((s) => s.clearBake)

  const [format, setFormat] = useState<ExportFormat>('glb')
  const isBusy = status === 'baking' || status === 'exporting' || status === 'preparing'

  const canBake = hasModel && hasPattern && !isBusy
  const canExport = hasModel && hasPattern && !isBusy
  const exportReady = status === 'export-ready' || status === 'complete'

  return (
    <Panel title="Bake & Export" id="export-panel">
      <div className="space-y-3">
        <div className="rounded-lg border border-purple-500/20 bg-purple-950/30 px-3 py-2">
          <p className="text-[11px] text-purple-300/90 font-medium">Workflow</p>
          <ol className="mt-1 text-[10px] text-slate-400 space-y-0.5 list-decimal list-inside">
            <li>Select surface → choose pattern → adjust controls</li>
            <li>Preview updates in the viewer</li>
            <li>Bake / Apply to Mesh → export GLB, STL, or OBJ</li>
          </ol>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {exportReady ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          ) : status === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          ) : isBusy ? (
            <Loader2 className="h-3.5 w-3.5 text-purple-400 loading-spinner shrink-0" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-purple-500/60 shrink-0" />
          )}
          <span className="text-slate-300">{statusLabel(status)}</span>
        </div>

        {!selectedSurface && hasModel && (
          <p className="text-[11px] text-amber-400/90">No surface selected — apply a pattern to a surface first.</p>
        )}
        {!hasPattern && hasModel && (
          <p className="text-[11px] text-amber-400/90">No pattern applied yet.</p>
        )}

        <label className="block text-xs text-slate-400">
          Tessellation ({segmentCount}×{segmentCount})
          <input
            type="range"
            min={16}
            max={128}
            step={8}
            value={segmentCount}
            disabled={!hasModel || isBusy}
            onChange={(e) => setSegmentCount(Number(e.target.value))}
            className="mt-1 w-full accent-purple-500"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showBakedInScene}
            onChange={(e) => setShowBakedInScene(e.target.checked)}
            className="accent-purple-500"
          />
          Show baked geometry in viewer
        </label>

        <Button
          icon={isBusy && status === 'baking' ? <Loader2 className="h-3.5 w-3.5 loading-spinner" /> : <Hammer className="h-3.5 w-3.5" />}
          disabled={!canBake}
          onClick={() => void bake()}
          className="w-full text-xs"
        >
          Bake / Apply to Mesh
        </Button>

        <div className="space-y-2">
          <label className="block text-xs text-slate-400">
            Export format
            <select
              value={format}
              disabled={!hasModel}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="mt-1 w-full rounded-lg border border-purple-500/20 bg-navy-900/80 px-2 py-1.5 text-xs text-slate-200"
            >
              <option value="glb">GLB (geometry + material)</option>
              <option value="stl">STL (geometry only)</option>
              <option value="obj">OBJ (geometry only)</option>
            </select>
          </label>
          <p className="text-[10px] text-slate-500">{FORMAT_NOTES[format]}</p>
        </div>

        <Button
          icon={isBusy && (status === 'exporting' || status === 'preparing') ? <Loader2 className="h-3.5 w-3.5 loading-spinner" /> : <Download className="h-3.5 w-3.5" />}
          disabled={!canExport}
          onClick={() => void exportModel(format)}
          className="w-full text-xs"
          variant="primary"
        >
          Export Modified Model
        </Button>

        {(status === 'export-ready' || status === 'complete') && (
          <Button disabled={isBusy} onClick={clearBake} className="w-full text-xs" variant="ghost">
            Clear baked geometry
          </Button>
        )}

        {error && (
          <p className="text-[11px] text-red-400">{error}</p>
        )}

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
