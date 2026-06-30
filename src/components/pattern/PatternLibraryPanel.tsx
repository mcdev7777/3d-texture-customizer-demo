import clsx from 'clsx'
import { useMemo } from 'react'
import { Panel } from '../ui/Panel'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { PATTERN_DEFINITIONS, createPatternThumbnail } from '../../utils/patternTextures'
import type { PatternId } from '../../types/pattern'

export function PatternLibraryPanel() {
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const applyPattern = usePatternStore((s) => s.applyPattern)
  const currentPatternId = usePatternStore((s) =>
    selectedSurface ? s.placements[selectedSurface.surfaceId]?.settings.patternId : null,
  )
  const setPreviewActive = useBakeStore((s) => s.setPreviewActive)

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
    setPreviewActive(true)
  }

  return (
    <Panel title="Texture Library" id="patterns-panel">
      {!selectedSurface ? (
        <p className="text-xs text-slate-500 mb-3">Select a surface or part first.</p>
      ) : (
        <p className="text-xs text-slate-400 mb-3">
          Applying to {selectedSurface.meshName || 'surface'}
          {selectedSurface.selectionType === 'part' ? ' (part)' : ''}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {PATTERN_DEFINITIONS.map((def) => (
          <button
            key={def.id}
            type="button"
            disabled={!selectedSurface}
            onClick={() => handleSelect(def.id)}
            title={def.label}
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
              className="w-full aspect-square rounded object-cover mb-1 bg-navy-950"
            />
            <span className="text-[10px] text-slate-300 leading-tight block truncate">
              {def.label}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  )
}
