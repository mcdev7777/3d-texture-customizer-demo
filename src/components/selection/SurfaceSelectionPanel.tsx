import clsx from 'clsx'
import { X } from 'lucide-react'
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
  const hasSeed = useSurfaceSelectionStore((s) => s.lastPick !== null)

  const modes: { id: SelectionMode; label: string }[] = [
    { id: 'surface', label: 'Surface' },
    { id: 'part', label: 'Part' },
  ]

  const isSurfaceMode = selectionMode === 'surface'

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

      {isSurfaceMode && (
        <div className="mt-4 pt-3 border-t border-purple-500/10 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-purple-300">Select by angle</span>
            <span className="text-[10px] text-purple-400/70">live</span>
          </div>

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

          {enabled && hasModel && (
            <p className="text-[11px] text-slate-400">
              {hasSeed
                ? 'Angle selection active — drag the threshold to grow or shrink the region.'
                : 'Click a surface to start angle selection.'}
            </p>
          )}
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
            {isSurfaceMode && <StatRow label="Threshold" value={`${angleTolerance.toFixed(0)}°`} />}
            <StatRow label="Normal" value={formatNormal(selectedSurface.normal)} />
            <StatRow label="Area" value={formatArea(selectedSurface.area)} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {!hasModel
              ? 'Load a model to begin.'
              : !enabled
                ? 'Enable selection to pick a surface or part.'
                : isSurfaceMode
                  ? 'Click a surface to start angle selection.'
                  : 'Click a part of the model to select the whole mesh.'}
          </p>
        )}
      </div>
    </Panel>
  )
}
