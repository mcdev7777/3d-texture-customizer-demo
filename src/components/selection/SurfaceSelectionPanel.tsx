import clsx from 'clsx'
import { X } from 'lucide-react'
import type { Mesh } from 'three'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { ToggleRow } from '../ui/ToggleRow'
import { useAppStore } from '../../store/useAppStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore, type PatternCoherenceMode } from '../../store/usePatternStore'
import { usePartTransformStore, type Axis } from '../../store/usePartTransformStore'
import {
  MAX_ANGLE_TOLERANCE,
  MIN_ANGLE_TOLERANCE,
  type SelectionMode,
} from '../../types/surfaceSelection'
import { formatArea, formatNormal } from '../../lib/surface/buildSelectedSurfaceGeometry'

const AXES: Axis[] = ['x', 'y', 'z']

function PartTransformControls({ meshUuid }: { meshUuid: string }) {
  const modelRoot = useSurfaceSelectionStore((s) => s.modelRoot)
  const entry = usePartTransformStore((s) => s.entries[meshUuid])
  const setRotation = usePartTransformStore((s) => s.setRotation)
  const setScale = usePartTransformStore((s) => s.setScale)
  const resetPart = usePartTransformStore((s) => s.resetPart)

  const mesh = modelRoot?.getObjectByProperty('uuid', meshUuid) as Mesh | undefined
  const scaleMultiplier = entry?.scaleMultiplier ?? 1
  const hasOverride = !!entry

  if (!mesh) return null

  return (
    <div className="mt-4 pt-3 border-t border-purple-500/10 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-purple-300">Rotate / scale part</span>
        {hasOverride && (
          <button
            type="button"
            onClick={() => resetPart(mesh)}
            className="text-[10px] text-slate-400 hover:text-purple-300"
          >
            Reset
          </button>
        )}
      </div>

      {AXES.map((axis) => (
        <div key={axis}>
          <label className="block text-xs text-slate-400 mb-2">
            Rotate {axis.toUpperCase()} — {(entry?.rotationDeltaDeg[axis] ?? 0).toFixed(0)}°
          </label>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={entry?.rotationDeltaDeg[axis] ?? 0}
            onChange={(e) => setRotation(mesh, axis, Number(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
      ))}

      <div>
        <label className="block text-xs text-slate-400 mb-2">
          Scale — {scaleMultiplier.toFixed(2)}x
        </label>
        <input
          type="range"
          min={0.1}
          max={4}
          step={0.05}
          value={scaleMultiplier}
          onChange={(e) => setScale(mesh, Number(e.target.value))}
          className="w-full accent-purple-500"
        />
      </div>
    </div>
  )
}

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
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const clearSelection = useSurfaceSelectionStore((s) => s.clearSelection)
  const hasSeed = useSurfaceSelectionStore((s) => s.lastPick !== null)
  const selectionCount = selectedSurfaces.length
  const patternCoherence = usePatternStore((s) => s.patternCoherence)
  const setPatternCoherence = usePatternStore((s) => s.setPatternCoherence)

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
                : 'Click a surface to start angle selection. Shift+click to add more.'}
            </p>
          )}
        </div>
      )}

      <div className="mt-3">
        <Button
          icon={<X className="h-3.5 w-3.5" />}
          disabled={selectionCount === 0}
          onClick={clearSelection}
          className="w-full text-xs"
        >
          Clear selection
        </Button>
        {enabled && hasModel && (
          <p className="text-[10px] text-slate-500 mt-2">
            Shift+click adds to selection · Right-click clears
          </p>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-purple-500/10">
        {selectedSurface ? (
          <div className="space-y-0.5">
            {selectionCount > 1 && (
              <StatRow label="Selected" value={`${selectionCount} regions`} />
            )}
            <StatRow
              label="Active"
              value={
                selectionCount > 1
                  ? `${selectedSurface.meshName} (${selectedSurface.selectionType})`
                  : selectedSurface.selectionType === 'part'
                    ? 'Part'
                    : 'Surface'
              }
            />
            <StatRow label="Mesh" value={selectedSurface.meshName} />
            <StatRow label="Faces" value={selectedSurface.triangleCount.toLocaleString()} />
            {isSurfaceMode && <StatRow label="Threshold" value={`${angleTolerance.toFixed(0)}°`} />}
            <StatRow label="Normal" value={formatNormal(selectedSurface.normal)} />
            <StatRow label="Area" value={formatArea(selectedSurface.area)} />
            {selectedSurface.selectionType === 'part' && (
              <PartTransformControls meshUuid={selectedSurface.meshUuid} />
            )}
            {selectionCount > 1 && (
              <>
                <p className="text-[10px] text-slate-500 pt-1">
                  Texture library, placement, preview, and apply affect all selected regions.
                </p>
                <div className="pt-2">
                  <span className="block text-xs font-medium text-purple-300 mb-2">
                    Pattern across selection
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'individual', label: 'Individual' },
                        { id: 'merged', label: 'Merged' },
                      ] satisfies { id: PatternCoherenceMode; label: string }[]
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPatternCoherence(m.id)}
                        className={clsx(
                          'rounded-lg px-2 py-2 text-xs font-medium border transition-all',
                          patternCoherence === m.id
                            ? 'border-purple-400 bg-purple-600/25 text-white'
                            : 'border-purple-500/20 text-slate-400 hover:bg-white/5',
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 pt-2">
                    {patternCoherence === 'merged'
                      ? 'One continuous pattern mapped across all selected surfaces — no seam at each face boundary.'
                      : 'Each selected surface gets its own independent pattern placement.'}
                  </p>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {!hasModel
              ? 'Load a model to begin.'
              : !enabled
                ? 'Enable selection to pick a surface or part.'
                : isSurfaceMode
                  ? 'Click a surface to start angle selection. Shift+click to add more.'
                  : 'Click a part to select the whole mesh. Shift+click to add more.'}
          </p>
        )}
      </div>
    </Panel>
  )
}
