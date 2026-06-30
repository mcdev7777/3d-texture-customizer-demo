import { useCallback, useEffect, useState } from 'react'
import {
  Save,
  FolderOpen,
  Trash2,
  Copy,
  Pencil,
  RotateCcw,
  Download,
  Upload,
} from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore, placementsToSerializable } from '../../store/useBakeStore'
import {
  createVariantId,
  deleteVariant,
  duplicateVariant,
  exportVariantJson,
  importVariantJson,
  listVariants,
  renameVariant,
  saveVariant,
  type SavedVariant,
} from '../../lib/variants/variantStorage'
import { sanitizePlacements } from '../../lib/variants/validateVariant'
import { restoreSurfaceSelection } from '../../lib/surface/restoreSurfaceFromId'
import type { SurfacePatternPlacement } from '../../types/pattern'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function restorePlacements(placements: SavedVariant['placements']): void {
  const record: Record<string, SurfacePatternPlacement> = {}
  for (const p of sanitizePlacements(placements)) {
    record[p.surfaceId] = {
      surfaceId: p.surfaceId,
      label: p.label,
      settings: {
        patternId: p.patternId,
        mode: p.mode,
        scale: p.scale,
        rotation: p.rotation,
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        depth: p.depth,
        opacity: p.opacity,
      },
      plane: p.plane,
    }
  }
  usePatternStore.setState({ placements: record })
}

export function VariantsPanel() {
  const fileName = useAppStore((s) => s.fileName)
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const selectedSurfaceId = useSurfaceSelectionStore((s) => s.selectedSurface?.surfaceId)
  const placements = usePatternStore((s) => s.placements)
  const markPending = useBakeStore((s) => s.markPending)
  const clearBake = useBakeStore((s) => s.clearBake)

  const [variants, setVariants] = useState<SavedVariant[]>(() => listVariants())
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const refresh = useCallback(() => setVariants(listVariants()), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const buildVariant = (name: string, id?: string): SavedVariant => {
    const now = new Date().toISOString()
    return {
      id: id ?? createVariantId(),
      name,
      createdAt: now,
      updatedAt: now,
      sourceModelName: fileName ?? undefined,
      placements: placementsToSerializable(placements),
      selectedSurfaceId,
    }
  }

  const handleSaveNew = () => {
    const name = newName.trim() || `Variant ${variants.length + 1}`
    try {
      const variant = buildVariant(name)
      saveVariant(variant)
      setActiveVariantId(variant.id)
      setNewName('')
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Save failed.')
    }
  }

  const handleUpdate = () => {
    if (!activeVariantId) return
    const existing = variants.find((v) => v.id === activeVariantId)
    if (!existing) return
    try {
      const updated: SavedVariant = {
        ...existing,
        updatedAt: new Date().toISOString(),
        sourceModelName: fileName ?? existing.sourceModelName,
        placements: placementsToSerializable(placements),
        selectedSurfaceId,
      }
      saveVariant(updated)
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed.')
    }
  }

  const handleLoad = (variant: SavedVariant) => {
    restorePlacements(variant.placements)
    setActiveVariantId(variant.id)
    clearBake()
    restoreSurfaceSelection(
      variant.selectedSurfaceId,
      useAppStore.getState().loadedModel?.object ?? null,
    )
    markPending()
    refresh()
  }

  const handleDelete = (id: string) => {
    const variant = variants.find((v) => v.id === id)
    if (!variant) return
    if (!window.confirm(`Delete variant "${variant.name}"?`)) return
    deleteVariant(id)
    if (activeVariantId === id) setActiveVariantId(null)
    refresh()
  }

  const handleRename = (id: string) => {
    const trimmed = editName.trim()
    if (!trimmed) return
    renameVariant(id, trimmed)
    setEditingId(null)
    refresh()
  }

  const handleDuplicate = (id: string) => {
    const copy = duplicateVariant(id)
    if (copy) {
      setActiveVariantId(copy.id)
      refresh()
    }
  }

  const handleReset = () => {
    if (!window.confirm('Reset all pattern placements?')) return
    usePatternStore.getState().clearAll()
    clearBake()
    setActiveVariantId(null)
    markPending()
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const variant = importVariantJson(text)
        refresh()
        handleLoad(variant)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import failed.')
      }
    }
    input.click()
  }

  return (
    <Panel title="Variants">
      <p className="text-[10px] text-slate-500 mb-3">
        Saved in this browser for demo purposes.
      </p>

      <div className="space-y-2 mb-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Variant name"
            value={newName}
            disabled={!hasModel}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border border-purple-500/20 bg-navy-900/80 px-2 py-1.5 text-xs text-slate-200"
          />
          <Button
            icon={<Save className="h-3.5 w-3.5" />}
            disabled={!hasModel}
            onClick={handleSaveNew}
            className="text-xs px-2 shrink-0"
          >
            Save
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={<Save className="h-3.5 w-3.5" />}
            disabled={!activeVariantId || !hasModel}
            onClick={handleUpdate}
            className="text-xs px-2 py-1.5"
          >
            Update
          </Button>
          <Button
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            disabled={!hasModel}
            onClick={handleReset}
            className="text-xs px-2 py-1.5"
            variant="ghost"
          >
            Reset
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={<Upload className="h-3.5 w-3.5" />}
            onClick={handleImport}
            className="text-xs px-2 py-1.5"
            variant="ghost"
          >
            Import JSON
          </Button>
        </div>
      </div>

      {variants.length === 0 ? (
        <p className="text-xs text-slate-500">No saved variants yet.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {variants.map((variant) => (
            <li
              key={variant.id}
              className={`rounded-lg border px-2 py-2 text-xs ${
                activeVariantId === variant.id
                  ? 'border-purple-500/40 bg-purple-950/40'
                  : 'border-purple-500/15 bg-navy-900/40'
              }`}
            >
              {editingId === variant.id ? (
                <div className="flex gap-1">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 rounded border border-purple-500/20 bg-navy-950 px-1.5 py-0.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleRename(variant.id)}
                    className="text-purple-400 hover:text-purple-300"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-medium text-slate-200 truncate">{variant.name}</p>
                  <p className="text-[10px] text-slate-500">{formatDate(variant.updatedAt)}</p>
                  <p className="text-[10px] text-slate-500">
                    {variant.placements.length} pattern{variant.placements.length === 1 ? '' : 's'}
                  </p>
                </>
              )}

              <div className="flex flex-wrap gap-1 mt-2">
                <button
                  type="button"
                  title="Load"
                  disabled={!hasModel}
                  onClick={() => handleLoad(variant)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300 disabled:opacity-40"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Rename"
                  onClick={() => {
                    setEditingId(variant.id)
                    setEditName(variant.name)
                  }}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  onClick={() => handleDuplicate(variant.id)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Export JSON"
                  onClick={() => exportVariantJson(variant)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => handleDelete(variant.id)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
