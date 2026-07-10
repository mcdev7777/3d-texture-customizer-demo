import clsx from 'clsx'
import { useState } from 'react'
import { Link2, Link2Off, RotateCcw } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { getPatternTargetSurfaceIds } from '../../lib/pattern/selectionTargets'
import {
  DEPTH_MAX,
  DEPTH_MIN,
  SCALE_MAX,
  SCALE_MIN,
  type PatternMode,
} from '../../types/pattern'

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className={clsx('py-1.5', disabled && 'opacity-40')}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-300">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />
    </div>
  )
}

export function PatternControlsPanel() {
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const selectedSurfaces = useSurfaceSelectionStore((s) => s.selectedSurfaces)
  const surfaceId = selectedSurface?.surfaceId ?? null
  const targetSurfaceIds = getPatternTargetSurfaceIds()

  const placement = usePatternStore((s) => (surfaceId ? s.placements[surfaceId] : null))
  const updateSettingsMany = usePatternStore((s) => s.updateSettingsMany)
  const resetSurface = usePatternStore((s) => s.resetSurface)
  const removeCommitted = useBakeStore((s) => s.removeCommitted)
  const setPreviewActive = useBakeStore((s) => s.setPreviewActive)

  const [scaleLinked, setScaleLinked] = useState(true)

  const settings = placement?.settings
  const hasPattern = settings?.patternId != null
  const scaleX = settings ? settings.scaleX ?? settings.scale : 1
  const scaleY = settings ? settings.scaleY ?? settings.scale : 1

  const setMode = (mode: PatternMode) => {
    if (!surfaceId) return
    updateSettingsMany(targetSurfaceIds, { mode })
    setPreviewActive(true)
  }

  const patch = (partial: Parameters<typeof updateSettingsMany>[1]) => {
    if (!surfaceId) return
    updateSettingsMany(targetSurfaceIds, partial)
    setPreviewActive(true)
  }

  return (
    <Panel title="Texture Placement">
      {!selectedSurface ? (
        <p className="text-xs text-slate-500">No surface selected.</p>
      ) : !hasPattern || !settings ? (
        <p className="text-xs text-slate-500">Choose a pattern from the library.</p>
      ) : (
        <>
          <p className="text-xs text-slate-400 mb-3">
            Pattern on {placement?.label ?? selectedSurface.meshName}
            {selectedSurfaces.length > 1 ? ` (+${selectedSurfaces.length - 1} more)` : ''}
          </p>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode('emboss')}
              className={clsx(
                'rounded-lg px-2 py-2 text-xs font-medium border transition-all',
                settings.mode === 'emboss'
                  ? 'border-purple-400 bg-purple-600/25 text-white'
                  : 'border-purple-500/20 text-slate-400 hover:bg-white/5',
              )}
            >
              Emboss
            </button>
            <button
              type="button"
              onClick={() => setMode('engrave')}
              className={clsx(
                'rounded-lg px-2 py-2 text-xs font-medium border transition-all',
                settings.mode === 'engrave'
                  ? 'border-purple-400 bg-purple-600/25 text-white'
                  : 'border-purple-500/20 text-slate-400 hover:bg-white/5',
              )}
            >
              Engrave
            </button>
          </div>

          <div className="flex items-center justify-between pt-1.5">
            <span className="text-xs text-slate-400">Scale</span>
            <button
              type="button"
              onClick={() => setScaleLinked((v) => !v)}
              title={scaleLinked ? 'Scale X and Y linked' : 'Scale X and Y independent'}
              className={clsx(
                'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-all',
                scaleLinked
                  ? 'border-purple-400 bg-purple-600/25 text-white'
                  : 'border-purple-500/20 text-slate-400 hover:bg-white/5',
              )}
            >
              {scaleLinked ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
              {scaleLinked ? 'Linked' : 'Free'}
            </button>
          </div>
          <SliderRow
            label="Scale X"
            value={scaleX}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) =>
              patch(scaleLinked ? { scale: v, scaleX: v, scaleY: v } : { scale: v, scaleX: v })
            }
          />
          <SliderRow
            label="Scale Y"
            value={scaleY}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) =>
              patch(scaleLinked ? { scale: v, scaleX: v, scaleY: v } : { scaleY: v })
            }
          />
          <SliderRow
            label="Rotation"
            value={settings.rotation}
            min={0}
            max={360}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onChange={(v) => patch({ rotation: v })}
          />
          <SliderRow
            label="Offset X"
            value={settings.offsetX}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patch({ offsetX: v })}
          />
          <SliderRow
            label="Offset Y"
            value={settings.offsetY}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patch({ offsetY: v })}
          />
          <SliderRow
            label="Depth"
            value={settings.depth}
            min={DEPTH_MIN}
            max={DEPTH_MAX}
            step={0.05}
            format={(v) => `${v.toFixed(2)}mm`}
            onChange={(v) => patch({ depth: v })}
          />

          <div className="mt-3 pt-3 border-t border-purple-500/10">
            <Button
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => {
                if (!surfaceId) return
                for (const id of targetSurfaceIds) {
                  resetSurface(id)
                  removeCommitted(id)
                }
                setPreviewActive(false)
              }}
              className="w-full text-xs"
            >
              Reset surface pattern
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
