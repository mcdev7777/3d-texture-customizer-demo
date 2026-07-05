import { useAppStore } from '../../store/useAppStore'
import { useBakeStore } from '../../store/useBakeStore'

export function BottomStatusBar() {
  const fileName = useAppStore((s) => s.fileName)
  const modelStats = useAppStore((s) => s.modelStats)
  const isLoading = useAppStore((s) => s.isLoading)
  const hasModel = useAppStore((s) => !!s.loadedModel)
  const bakeStatus = useBakeStore((s) => s.status)
  const appliedCount = useBakeStore((s) => s.committedSurfaceIds.length)
  const previewActive = useBakeStore((s) => s.previewActive)

  const bakeLabel =
    bakeStatus === 'applying'
      ? 'Applying…'
      : bakeStatus === 'error'
        ? 'Error'
        : appliedCount > 0
          ? `${appliedCount} textured`
          : previewActive
            ? 'Preview'
            : null

  return (
    <footer className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2 panel-glass rounded-xl text-xs text-slate-400 shrink-0">
      <div className="flex items-center gap-3 min-w-0 flex-wrap">
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isLoading ? 'bg-yellow-400 animate-pulse' : hasModel ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
          />
          {isLoading ? 'Loading…' : hasModel ? 'Model ready' : 'Ready'}
        </span>
        {fileName && (
          <span className="truncate text-slate-300 max-w-[180px] sm:max-w-[240px]" title={fileName}>
            {fileName}
          </span>
        )}
        {modelStats && (
          <span className="text-slate-500">
            {modelStats.triangleCount.toLocaleString()} tris ·{' '}
            {modelStats.vertexCount.toLocaleString()} verts
          </span>
        )}
        {bakeLabel && (
          <span className="text-purple-400/80">{bakeLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-3 text-slate-500 shrink-0 flex-wrap">
        <span>LMB — Orbit</span>
        <span className="hidden sm:inline">MMB — Pan</span>
        <span>Scroll — Zoom</span>
      </div>
    </footer>
  )
}
