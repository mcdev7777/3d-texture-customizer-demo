import { useCallback, useEffect, useState } from 'react'
import {
  Save,
  FolderOpen,
  Trash2,
  Copy,
  Pencil,
  Download,
  Upload,
} from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { usePatternStore } from '../../store/usePatternStore'
import { useSurfaceSelectionStore } from '../../store/useSurfaceSelectionStore'
import { useBakeStore } from '../../store/useBakeStore'
import { applyVariation } from '../../lib/variants/applyVariation'
import {
  createVariationId,
  deleteVariation,
  duplicateVariation,
  exportVariationJson,
  importVariationJson,
  listVariations,
  placementsToSerializable,
  renameVariation,
  saveVariation,
} from '../../lib/variants/variantStorage'
import type { ModelVariation } from '../../types/variant'

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

export function VariationsPanel() {
  const fileName = useAppStore((s) => s.fileName)
  const modelRoot = useAppStore((s) => s.loadedModel?.object ?? null)
  const hasModel = !!modelRoot
  const selectedSurfaceId = useSurfaceSelectionStore((s) => s.selectedSurface?.surfaceId)
  const placements = usePatternStore((s) => s.placements)
  const committedSurfaceIds = useBakeStore((s) => s.committedSurfaceIds)

  const hasPattern = Object.values(placements).some((p) => p.settings.patternId)

  const [variations, setVariations] = useState<ModelVariation[]>(() => listVariations())
  const [activeVariationId, setActiveVariationId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const refresh = useCallback(() => setVariations(listVariations()), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const buildVariation = (name: string, id?: string): ModelVariation => {
    const now = new Date().toISOString()
    return {
      id: id ?? createVariationId(),
      name,
      createdAt: now,
      updatedAt: now,
      sourceModelName: fileName ?? undefined,
      placements: placementsToSerializable(placements, modelRoot),
      committedSurfaceIds: [...committedSurfaceIds],
      selectedSurfaceId,
    }
  }

  const handleSaveNew = () => {
    const name = newName.trim() || `Variation ${variations.length + 1}`
    try {
      const variation = buildVariation(name)
      saveVariation(variation)
      setActiveVariationId(variation.id)
      setNewName('')
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Save failed.')
    }
  }

  const handleUpdate = () => {
    if (!activeVariationId) return
    const existing = variations.find((v) => v.id === activeVariationId)
    if (!existing) return
    try {
      const updated: ModelVariation = {
        ...existing,
        updatedAt: new Date().toISOString(),
        sourceModelName: fileName ?? existing.sourceModelName,
        placements: placementsToSerializable(placements, modelRoot),
        committedSurfaceIds: [...committedSurfaceIds],
        selectedSurfaceId,
      }
      saveVariation(updated)
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed.')
    }
  }

  const handleLoad = (variation: ModelVariation) => {
    if (!modelRoot) return
    try {
      applyVariation(variation, modelRoot, fileName)
      setActiveVariationId(variation.id)
      refresh()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Load failed.')
    }
  }

  const handleDelete = (id: string) => {
    const variation = variations.find((v) => v.id === id)
    if (!variation) return
    if (!window.confirm(`Delete variation "${variation.name}"?`)) return
    deleteVariation(id)
    if (activeVariationId === id) setActiveVariationId(null)
    refresh()
  }

  const handleRename = (id: string) => {
    const trimmed = editName.trim()
    if (!trimmed) return
    renameVariation(id, trimmed)
    setEditingId(null)
    refresh()
  }

  const handleDuplicate = (id: string) => {
    const copy = duplicateVariation(id)
    if (copy) {
      setActiveVariationId(copy.id)
      refresh()
    }
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
        const variation = importVariationJson(text)
        refresh()
        if (modelRoot) handleLoad(variation)
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import failed.')
      }
    }
    input.click()
  }

  return (
    <Panel title="Variations" id="variations-panel">
      <p className="text-[10px] text-slate-500 mb-3">
        Save pattern placements and applied textures for this model. Stored in this browser.
      </p>

      <div className="space-y-2 mb-3">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Variation name"
            value={newName}
            disabled={!hasModel}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hasModel && hasPattern) handleSaveNew()
            }}
            className="flex-1 min-w-0 rounded-lg border border-purple-500/20 bg-navy-900/80 px-2 py-1.5 text-xs text-slate-200"
          />
          <Button
            icon={<Save className="h-3.5 w-3.5" />}
            disabled={!hasModel || !hasPattern}
            onClick={handleSaveNew}
            className="text-xs px-2 shrink-0"
          >
            Save
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={<Save className="h-3.5 w-3.5" />}
            disabled={!activeVariationId || !hasModel || !hasPattern}
            onClick={handleUpdate}
            className="text-xs px-2 py-1.5"
          >
            Update
          </Button>
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

      {variations.length === 0 ? (
        <p className="text-xs text-slate-500">No saved variations yet.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {variations.map((variation) => (
            <li
              key={variation.id}
              className={`rounded-lg border px-2 py-2 text-xs ${
                activeVariationId === variation.id
                  ? 'border-purple-500/40 bg-purple-950/40'
                  : 'border-purple-500/15 bg-navy-900/40'
              }`}
            >
              {editingId === variation.id ? (
                <div className="flex gap-1">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(variation.id)
                    }}
                    className="flex-1 rounded border border-purple-500/20 bg-navy-950 px-1.5 py-0.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleRename(variation.id)}
                    className="text-purple-400 hover:text-purple-300"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-medium text-slate-200 truncate">{variation.name}</p>
                  <p className="text-[10px] text-slate-500">{formatDate(variation.updatedAt)}</p>
                  <p className="text-[10px] text-slate-500">
                    {variation.placements.length} pattern
                    {variation.placements.length === 1 ? '' : 's'}
                    {variation.committedSurfaceIds.length > 0 &&
                      ` · ${variation.committedSurfaceIds.length} applied`}
                  </p>
                  {variation.sourceModelName && (
                    <p className="text-[10px] text-slate-600 truncate">{variation.sourceModelName}</p>
                  )}
                </>
              )}

              <div className="flex flex-wrap gap-1 mt-2">
                <button
                  type="button"
                  title="Load"
                  disabled={!hasModel}
                  onClick={() => handleLoad(variation)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300 disabled:opacity-40"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Rename"
                  onClick={() => {
                    setEditingId(variation.id)
                    setEditName(variation.name)
                  }}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  onClick={() => handleDuplicate(variation.id)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Export JSON"
                  onClick={() => exportVariationJson(variation)}
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-purple-300"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => handleDelete(variation.id)}
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
