import { X } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { ToggleRow } from '../ui/ToggleRow'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
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
  const angleTolerance = useSurfaceSelectionStore((s) => s.angleTolerance)
  const setAngleTolerance = useSurfaceSelectionStore((s) => s.setAngleTolerance)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const clearSelection = useSurfaceSelectionStore((s) => s.clearSelection)

  return (
    <Panel title="Surface Selection">
      <ToggleRow
        label="Selection mode"
        checked={enabled}
        onChange={setEnabled}
        disabled={!hasModel}
      />

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
        <label className="block text-xs text-slate-400 mb-2">
          Angle tolerance — {angleTolerance.toFixed(0)}°
        </label>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={angleTolerance}
          disabled={!hasModel}
          onChange={(e) => setAngleTolerance(Number(e.target.value))}
          className="w-full accent-purple-500"
        />
      </div>

      <div className="mt-4 pt-3 border-t border-purple-500/10">
        {selectedSurface ? (
          <div className="space-y-0.5">
            <StatRow label="Mesh" value={selectedSurface.meshName} />
            <StatRow label="Face" value={selectedSurface.faceIndex} />
            <StatRow label="Triangles" value={selectedSurface.triangleCount.toLocaleString()} />
            <StatRow label="Normal" value={formatNormal(selectedSurface.normal)} />
            <StatRow label="Area" value={formatArea(selectedSurface.area)} />
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {enabled ? 'Click a flat surface on the model.' : 'Enable selection mode to pick a surface.'}
          </p>
        )}
      </div>
    </Panel>
  )
}
