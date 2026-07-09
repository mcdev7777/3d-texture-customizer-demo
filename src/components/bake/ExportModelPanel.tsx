import { Download, Loader2, AlertTriangle } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useBakeStore } from '../../store/useBakeStore'
import type { ExportFormat, ExportQuality } from '../../types/bake'

const FORMATS: Array<{ format: ExportFormat; label: string; note: string }> = [
  { format: '3mf', label: '3MF', note: 'Printable relief — recommended for PrusaSlicer.' },
  { format: 'stl', label: 'STL', note: 'Geometry only — slicers and printers.' },
  { format: 'obj', label: 'OBJ', note: 'Geometry only — most 3D editors.' },
  { format: 'glb', label: 'GLB', note: 'Geometry and vertex colors.' },
]

const QUALITY_OPTIONS: Array<{ value: ExportQuality; label: string; note: string }> = [
  { value: 'low', label: 'Low', note: 'Smaller file, less detail.' },
  { value: 'medium', label: 'Medium', note: 'Balanced default.' },
  { value: 'high', label: 'High', note: 'More detail, larger file.' },
]

export function ExportModelPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const status = useBakeStore((s) => s.status)
  const error = useBakeStore((s) => s.error)
  const exportActive = useBakeStore((s) => s.exportActive)
  const exportProgress = useBakeStore((s) => s.exportProgress)
  const exportQuality = useBakeStore((s) => s.exportQuality)
  const setExportQuality = useBakeStore((s) => s.setExportQuality)
  const exportSmoothness = useBakeStore((s) => s.exportSmoothness)
  const setExportSmoothness = useBakeStore((s) => s.setExportSmoothness)
  const exportModel = useBakeStore((s) => s.exportModel)

  const hasPatterns = useBakeStore((s) => s.committedSurfaceIds.length > 0)
  const isApplying = status === 'applying'
  const canExport = hasModel && hasPatterns && !exportActive && !isApplying

  return (
    <Panel title="Export Model" id="export-panel">
      <p className="text-[10px] text-slate-500 mb-3">
        Bakes all applied pattern regions into real geometry at export time. The full model
        downloads with every committed texture — preview stays fast.
      </p>

      {hasModel && !hasPatterns && (
        <p className="text-[11px] text-amber-400/90 mb-2">
          Apply textures to surfaces before exporting.
        </p>
      )}

      <div className="mb-3">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">Export quality</span>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {QUALITY_OPTIONS.map(({ value, label, note }) => (
            <button
              key={value}
              type="button"
              disabled={isApplying}
              title={note}
              onClick={() => setExportQuality(value)}
              className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
                exportQuality === value
                  ? 'bg-purple-600/30 text-purple-200 ring-1 ring-purple-500/40'
                  : 'bg-white/5 text-slate-400 hover:bg-white/8'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Surface smoothness</span>
          <span className="text-[10px] text-purple-300 tabular-nums">{exportSmoothness}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={exportSmoothness}
          disabled={isApplying}
          onChange={(e) => setExportSmoothness(Number(e.target.value))}
          className="mt-1.5 w-full accent-purple-500 disabled:opacity-50"
        />
        <p className="mt-1 text-[10px] text-slate-500 leading-tight">
          Softens hard edges and facets on the exported print. Sharp corners stay crisp.
        </p>
      </div>

      {exportActive && exportProgress && (
        <div className="mb-3 rounded-md bg-white/5 p-2.5 ring-1 ring-white/10">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400 truncate">{exportProgress.label}</span>
            <span className="text-[10px] text-purple-300 tabular-nums shrink-0">
              {Math.round(exportProgress.fraction * 100)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-purple-500 transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(exportProgress.fraction * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {FORMATS.map(({ format, label, note }) => (
          <div key={format} className="flex items-center gap-2">
            <Button
              icon={
                exportActive ? (
                  <Loader2 className="h-3.5 w-3.5 loading-spinner" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )
              }
              disabled={!canExport}
              onClick={() => void exportModel(format)}
              className="text-xs px-2 py-1.5 shrink-0 w-24 justify-center"
              variant={format === '3mf' ? 'primary' : 'ghost'}
            >
              {label}
            </Button>
            <span className="text-[10px] text-slate-500 leading-tight">{note}</span>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </Panel>
  )
}
