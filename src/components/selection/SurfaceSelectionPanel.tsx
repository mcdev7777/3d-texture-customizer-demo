import clsx from 'clsx'
import { X, Wand2 } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { ToggleRow } from '../ui/ToggleRow'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import {
  MAX_ANGLE_TOLERANCE,
  MIN_ANGLE_TOLERANCE,
  type SelectionMode,
} from '../../types/surfaceSelection'
import { formatArea, formatNormal } from '../../lib/surface/buildSelectedSurfaceGeometry'

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-xs font-mono text-slate-200 text-right break-all">{value}</span>
    </div>
  )
}

export function SurfaceSelectionPanel() {
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const enabled = useSurfaceSelectionStore((s) => s.enabled)
  const setEnabled = useSurfaceSelectionStore((s) => s.setEnabled)
  const selectionMode = useSurfaceSelectionStore((s) => s.selectionMode)
  const setSelectionMode = useSurfaceSelectionStore((s) => s.setSelectionMode)
  const angleTolerance = useSurfaceSelectionStore((s) => s.angleTolerance)
  const setAngleTolerance = useSurfaceSelectionStore((s) => s.setAngleTolerance)
  const connectedOnly = useSurfaceSelectionStore((s) => s.connectedOnly)
  const setConnectedOnly = useSurfaceSelectionStore((s) => s.setConnectedOnly)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const clearSelection = useSurfaceSelectionStore((s) => s.clearSelection)
  const recompute = useSurfaceSelectionStore((s) => s.recomputeFromLastPick)
  const lastPick = useSurfaceSelectionStore((s) => s.lastPick)

  const modes: { id: SelectionMode; label: string }[] = [
    { id: 'surface', label: 'Surface' },
    { id: 'part', label: 'Part' },
  ]

  return (
    <Panel title="Selection" id="selection-panel">
      <ToggleRow
        label="Enable selection"
        checked={enabled}
        onChange={setEnabled}
        disabled={!hasModel}
      />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={!hasModel}
            onClick={() => setSelectionMode(m.id)}
            className={clsx(
              'rounded-lg px-2 py-2 text-xs font-medium border transition-all',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              selectionMode === m.id
                ? 'border-purple-400 bg-purple-600/25 text-white'
                : 'border-purple-500/20 text-slate-400 hover:bg-white/5',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {selectionMode === 'surface' && (
        <div className="mt-4 pt-3 border-t border-purple-500/10 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-2">
              Angle threshold — {angleTolerance.toFixed(0)}°
            </label>
            <input
              type="range"
              min={MIN_ANGLE_TOLERANCE}
              max={MAX_ANGLE_TOLERANCE}
              step={1}
              value={angleTolerance}
              disabled={!hasModel}
              onChange={(e) => setAngleTolerance(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>

          <ToggleRow
            label="Connected only"
            checked={connectedOnly}
            onChange={setConnectedOnly}
            disabled={!hasModel}
          />

          <Button
            icon={<Wand2 className="h-3.5 w-3.5" />}
            disabled={!lastPick}
            onClick={recompute}
            className="w-full text-xs"
          >
            Apply angle selection
          </Button>
        </div>
      )}

      <div className="mt-3">
        <Button
          icon={<X className="h-3.5 w-3.5" />}
          disabled={!selectedSurface}
          onClick={clearSelection}
          className="w-full text-xs"
        >
          Clear selection
        </Button>
      </div>

      <div className="mt-4 pt-3 border-t border-purple-500/10">
        {selectedSurface ? (
          <div className="space-y-0.5">
            <StatRow
              label="Type"
              value={selectedSurface.selectionType === 'part' ? 'Part' : 'Surface'}
            />
            <StatRow label="Mesh" value={selectedSurface.meshName} />
            <StatRow label="Faces" value={selectedSurface.triangleCount.toLocaleString()} />
            <StatRow label="Normal" value={formatNormal(selectedSurface.normal)} />
            <StatRow label="Area" value={formatArea(selectedSurface.area)} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {!hasModel
              ? 'Load a model to begin.'
              : enabled
                ? selectionMode === 'part'
                  ? 'Click a part of the model to select the whole mesh.'
                  : 'Click a surface on the model.'
                : 'Enable selection to pick a surface or part.'}
          </p>
        )}
      </div>
    </Panel>
  )
}
