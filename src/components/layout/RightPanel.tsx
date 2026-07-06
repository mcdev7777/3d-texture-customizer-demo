import { RotateCcw, Maximize2 } from 'lucide-react'
import { Panel } from '../ui/Panel'
import { Button } from '../ui/Button'
import { ToggleRow } from '../ui/ToggleRow'
import { FileDropzone } from '../upload/FileDropzone'
import { useAppStore } from '../../store/useAppStore'
import { formatFileTypeLabel } from '../../lib/loaders/loadModel'
import { SurfaceSelectionPanel } from '../selection/SurfaceSelectionPanel'
import { PatternLibraryPanel } from '../pattern/PatternLibraryPanel'
import { PatternControlsPanel } from '../pattern/PatternControlsPanel'
import { BakeExportPanel } from '../bake/BakeExportPanel'
import { ExportModelPanel } from '../bake/ExportModelPanel'
import { VariationsPanel } from '../bake/VariationsPanel'

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1">
      <span className="text-xs text-slate-400 shrink-0">{label}</span>
      <span className="text-xs font-mono text-slate-200 text-right break-all">{value}</span>
    </div>
  )
}

export function RightPanel() {
  const fileName = useAppStore((s) => s.fileName)
  const fileType = useAppStore((s) => s.fileType)
  const modelStats = useAppStore((s) => s.modelStats)
  const viewerSettings = useAppStore((s) => s.viewerSettings)
  const setViewerSetting = useAppStore((s) => s.setViewerSetting)
  const cameraActions = useAppStore((s) => s.cameraActions)
  const hasModel = useAppStore((s) => !!s.loadedModel)

  const dims = modelStats?.dimensions

  return (
    <aside className="flex flex-col w-full lg:w-64 shrink-0 gap-3 overflow-y-auto max-h-[40vh] lg:max-h-none">
      <div className="lg:hidden">
        <Panel title="Load Model" compact>
          <FileDropzone compact />
        </Panel>
      </div>

      <Panel title="Model Info">
        {hasModel ? (
          <div className="space-y-0.5">
            <StatRow label="File" value={fileName ?? '—'} />
            <StatRow label="Type" value={formatFileTypeLabel(fileType)} />
            <StatRow
              label="Dimensions"
              value={dims ? `${dims.width} × ${dims.height} × ${dims.depth}` : '—'}
            />
            <StatRow label="Meshes" value={modelStats?.meshCount ?? '—'} />
            <StatRow
              label="Vertices"
              value={modelStats?.vertexCount.toLocaleString() ?? '—'}
            />
            <StatRow
              label="Triangles"
              value={modelStats?.triangleCount.toLocaleString() ?? '—'}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500">No model loaded.</p>
        )}
      </Panel>

      <SurfaceSelectionPanel />

      <PatternLibraryPanel />
      <PatternControlsPanel />

      <BakeExportPanel />
      <ExportModelPanel />
      <VariationsPanel />

      <Panel title="Viewer">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Button
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            disabled={!hasModel}
            onClick={() => cameraActions?.reset()}
            className="text-xs px-2 py-1.5"
          >
            Reset
          </Button>
          <Button
            icon={<Maximize2 className="h-3.5 w-3.5" />}
            disabled={!hasModel}
            onClick={() => cameraActions?.fit()}
            className="text-xs px-2 py-1.5"
          >
            Fit
          </Button>
        </div>

        <div className="space-y-0.5">
          <ToggleRow
            label="Wireframe"
            checked={viewerSettings.showWireframe}
            onChange={(v) => setViewerSetting('showWireframe', v)}
            disabled={!hasModel}
          />
          <ToggleRow
            label="Axes"
            checked={viewerSettings.showAxes}
            onChange={(v) => setViewerSetting('showAxes', v)}
          />
          <ToggleRow
            label="Grid / Floor"
            checked={viewerSettings.showGrid}
            onChange={(v) => setViewerSetting('showGrid', v)}
          />
          <ToggleRow
            label="Bounding Box"
            checked={viewerSettings.showBoundingBox}
            onChange={(v) => setViewerSetting('showBoundingBox', v)}
            disabled={!hasModel}
          />
        </div>
      </Panel>
    </aside>
  )
}
