import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import type { PatternMode } from '../../types/pattern'

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
  const surfaceId = selectedSurface?.surfaceId ?? null

  const placement = usePatternStore((s) => (surfaceId ? s.placements[surfaceId] : null))
  const updateSettings = usePatternStore((s) => s.updateSettings)
  const resetSurface = usePatternStore((s) => s.resetSurface)

  const settings = placement?.settings
  const hasPattern = settings?.patternId != null

  const setMode = (mode: PatternMode) => {
    if (!surfaceId) return
    updateSettings(surfaceId, { mode })
  }

  const patch = (partial: Parameters<typeof updateSettings>[1]) => {
    if (!surfaceId) return
    updateSettings(surfaceId, partial)
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

          <SliderRow
            label="Scale"
            value={settings.scale}
            min={0.25}
            max={5}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => patch({ scale: v })}
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
            min={0}
            max={0.15}
            step={0.005}
            format={(v) => v.toFixed(3)}
            onChange={(v) => patch({ depth: v })}
          />

          <div className="mt-3 pt-3 border-t border-purple-500/10">
            <Button
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => surfaceId && resetSurface(surfaceId)}
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
