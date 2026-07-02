import { Download, Loader2, AlertTriangle } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useBakeStore } from '../../store/useBakeStore'
import type { ExportFormat } from '../../types/bake'

const FORMATS: Array<{ format: ExportFormat; label: string; note: string }> = [
  { format: 'stl', label: 'STL', note: 'Geometry only — slicers and printers.' },
  { format: 'obj', label: 'OBJ', note: 'Geometry only — most 3D editors.' },
  { format: 'glb', label: 'GLB', note: 'Geometry and material.' },
  { format: '3mf', label: '3MF', note: 'Print package — modern slicers.' },
]

export function ExportModelPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const status = useBakeStore((s) => s.status)
  const error = useBakeStore((s) => s.error)
  const appliedCount = useBakeStore((s) => s.committedSurfaceIds.length)
  const exportModel = useBakeStore((s) => s.exportModel)

  const isExporting = status === 'exporting'
  const canExport = hasModel && appliedCount > 0 && !isExporting

  return (
    <Panel title="Export Model" id="export-panel">
      <p className="text-[10px] text-slate-500 mb-3">
        Downloads the model with applied relief baked in. Preview helpers and selection
        highlights are never included.
      </p>

      {hasModel && appliedCount === 0 && (
        <p className="text-[11px] text-amber-400/90 mb-2">Apply a texture to enable export.</p>
      )}

      <div className="space-y-2">
        {FORMATS.map(({ format, label, note }) => (
          <div key={format} className="flex items-center gap-2">
            <Button
              icon={
                isExporting ? (
                  <Loader2 className="h-3.5 w-3.5 loading-spinner" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )
              }
              disabled={!canExport}
              onClick={() => void exportModel(format)}
              className="text-xs px-2 py-1.5 shrink-0 w-24 justify-center"
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
