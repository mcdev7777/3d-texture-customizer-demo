import clsx from 'clsx'
import { useMemo } from 'react'
import { Panel } from '../ui/Panel'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { PATTERN_DEFINITIONS, createPatternThumbnail } from '../../utils/patternTextures'
import type { PatternId } from '../../types/pattern'

export function PatternLibraryPanel() {
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const applyPattern = usePatternStore((s) => s.applyPattern)
  const currentPatternId = usePatternStore((s) =>
    selectedSurface ? s.placements[selectedSurface.surfaceId]?.settings.patternId : null,
  )

  const thumbnails = useMemo(() => {
    const map = new Map<PatternId, string>()
    for (const def of PATTERN_DEFINITIONS) {
      map.set(def.id, createPatternThumbnail(def.id))
    }
    return map
  }, [])

  const handleSelect = (patternId: PatternId) => {
    if (!selectedSurface) return
    applyPattern(selectedSurface, patternId)
  }

  return (
    <Panel title="Pattern Library">
      {!selectedSurface ? (
        <p className="text-xs text-slate-500 mb-3">Select a surface first.</p>
      ) : (
        <p className="text-xs text-slate-400 mb-3">
          Editing {selectedSurface.meshName || 'surface'} · face {selectedSurface.faceIndex}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {PATTERN_DEFINITIONS.map((def) => (
          <button
            key={def.id}
            type="button"
            disabled={!selectedSurface}
            onClick={() => handleSelect(def.id)}
            className={clsx(
              'rounded-lg border p-1.5 text-left transition-all',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              currentPatternId === def.id
                ? 'border-purple-400 bg-purple-600/20 shadow-[0_0_10px_rgba(124,58,237,0.2)]'
                : 'border-purple-500/20 hover:border-purple-400/40 hover:bg-white/5',
            )}
          >
            <img
              src={thumbnails.get(def.id)}
              alt={def.label}
              className="w-full aspect-square rounded object-cover mb-1"
            />
            <span className="text-[10px] text-slate-300 leading-tight block">{def.label}</span>
          </button>
        ))}
      </div>
    </Panel>
  )
}
