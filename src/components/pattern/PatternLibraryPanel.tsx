import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useBakeStore } from '../../store/useBakeStore'
import { useCustomTextureStore } from '../../store/useCustomTextureStore'
import { PATTERN_DEFINITIONS, createPatternThumbnail } from '../../utils/patternTextures'
import type { PatternId } from '../../types/pattern'

function PatternButton({
  id,
  label,
  thumbnail,
  selected,
  disabled,
  onSelect,
}: {
  id: PatternId
  label: string
  thumbnail: string
  selected: boolean
  disabled: boolean
  onSelect: (id: PatternId) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      title={label}
      className={clsx(
        'rounded-lg border p-1.5 text-left transition-all',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        selected
          ? 'border-purple-400 bg-purple-600/20 shadow-[0_0_10px_rgba(124,58,237,0.2)]'
          : 'border-purple-500/20 hover:border-purple-400/40 hover:bg-white/5',
      )}
    >
      <img
        src={thumbnail}
        alt={label}
        className="w-full aspect-square rounded object-cover mb-1 bg-navy-950"
      />
      <span className="text-[10px] text-slate-300 leading-tight block truncate">{label}</span>
    </button>
  )
}

export function PatternLibraryPanel() {
  const selectedSurface = useSurfaceSelectionStore((s) => s.selectedSurface)
  const applyPattern = usePatternStore((s) => s.applyPattern)
  const currentPatternId = usePatternStore((s) =>
    selectedSurface ? s.placements[selectedSurface.surfaceId]?.settings.patternId : null,
  )
  const setPreviewActive = useBakeStore((s) => s.setPreviewActive)

  const customTextures = useCustomTextureStore((s) => s.textures)
  const addCustomFromFile = useCustomTextureStore((s) => s.addFromFile)
  const removeCustom = useCustomTextureStore((s) => s.remove)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

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

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadError(null)
    try {
      const texture = await addCustomFromFile(files[0])
      if (selectedSurface) handleSelect(texture.id)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not load that image.')
    }
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
          <PatternButton
            key={def.id}
            id={def.id}
            label={def.label}
            thumbnail={thumbnails.get(def.id) ?? ''}
            selected={currentPatternId === def.id}
            disabled={!selectedSurface}
            onSelect={handleSelect}
          />
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-purple-500/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-400">Custom textures</span>
          <Button
            icon={<Upload className="h-3.5 w-3.5" />}
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] px-2 py-1"
          >
            Load Texture
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <p className="text-[10px] text-slate-500 mb-2">
          PNG/JPG/WebP used as a height mask — light areas raise, dark areas stay flat. Saved
          automatically in this browser.
        </p>

        {uploadError && <p className="text-[11px] text-red-400 mb-2">{uploadError}</p>}

        {customTextures.length === 0 ? (
          <p className="text-[11px] text-slate-600">No custom textures loaded yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {customTextures.map((tex) => (
              <div key={tex.id} className="relative group">
                <PatternButton
                  id={tex.id}
                  label={tex.name}
                  thumbnail={tex.thumbnailUrl}
                  selected={currentPatternId === tex.id}
                  disabled={!selectedSurface}
                  onSelect={handleSelect}
                />
                <button
                  type="button"
                  title="Remove"
                  onClick={() => removeCustom(tex.id)}
                  className="absolute top-1 right-1 rounded bg-navy-950/80 p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}
