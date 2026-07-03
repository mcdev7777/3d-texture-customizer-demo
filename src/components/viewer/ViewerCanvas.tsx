import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import { Loader2, Box, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { isWebGLAvailable } from '../../lib/three/webgl'
import { ViewerErrorBoundary } from './ViewerErrorBoundary'
import { FloorGrid } from './FloorGrid'
import { ModelRenderer } from './ModelRenderer'
import { CameraController } from './CameraController'
import { BoundingBox } from './BoundingBox'
import { SurfacePicker } from '../selection/SurfacePicker'
import { SelectedSurfaceOverlay } from '../selection/SelectedSurfaceOverlay'
import { ModelDimEffect } from '../selection/ModelDimEffect'
import { TexturePreviewOverlay } from '../texture/TexturePreviewOverlay'

function SceneContent() {
  const showAxes = useAppStore((s) => s.viewerSettings.showAxes)
  const loadedModel = useAppStore((s) => s.loadedModel)

  return (
    <>
      <PerspectiveCamera makeDefault position={[5, 4, 5]} fov={45} near={0.01} far={1000} />
      <CameraController />

      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 12, 6]} intensity={1.1} />
      <directionalLight position={[-6, 4, -4]} intensity={0.35} color="#c4b5fd" />
      <pointLight position={[0, 6, 0]} intensity={0.2} color="#a78bfa" />

      <FloorGrid />

      {showAxes && <axesHelper args={[3]} />}

      <Suspense fallback={null}>
        <ModelRenderer />
      </Suspense>

      <ModelDimEffect />
      <SelectedSurfaceOverlay />
      <TexturePreviewOverlay />
      <SurfacePicker />

      <BoundingBox object={loadedModel?.object ?? null} />
    </>
  )
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 px-6">
      <div className="empty-state-icon mb-4 rounded-2xl bg-purple-950/80 border border-purple-500/20 p-6 panel-glow">
        <Box className="h-12 w-12 text-purple-400" strokeWidth={1.2} />
      </div>
      <h2 className="text-lg font-medium text-slate-200 mb-1">No model loaded</h2>
      <p className="text-sm text-slate-400 max-w-sm text-center">
        Open a model file or drag one into the workspace.
      </p>
    </div>
  )
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-navy-950/75 z-20">
      <div className="panel-glass rounded-xl px-6 py-4 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-purple-400 loading-spinner" />
        <span className="text-sm text-slate-300">Loading model…</span>
      </div>
    </div>
  )
}

function WebGLUnavailable() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center z-10">
      <AlertTriangle className="h-10 w-10 text-amber-400 mb-3" />
      <h2 className="text-lg font-medium text-slate-200 mb-2">3D viewer unavailable</h2>
      <p className="text-sm text-slate-400 max-w-md">
        WebGL is not available. Check that hardware acceleration is enabled in your browser
        settings, then reload.
      </p>
    </div>
  )
}

function ViewerErrorFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center z-10">
      <AlertTriangle className="h-10 w-10 text-red-400 mb-3" />
      <h2 className="text-lg font-medium text-slate-200 mb-2">Viewer failed to start</h2>
      <p className="text-sm text-slate-400 max-w-md">
        The 3D view could not be initialized. Reload the page to try again.
      </p>
    </div>
  )
}

export function ViewerCanvas() {
  const loadedModel = useAppStore((s) => s.loadedModel)
  const isLoading = useAppStore((s) => s.isLoading)
  const error = useAppStore((s) => s.error)
  const [webglOk] = useState(() => isWebGLAvailable())

  return (
    <div className="viewer-shell relative flex-1 min-h-[280px] w-full rounded-xl overflow-hidden border border-purple-500/15 panel-glow">
      {webglOk ? (
        <div className="viewer-canvas-host">
          <ViewerErrorBoundary
            resetKey={loadedModel?.object.uuid ?? 'empty'}
            fallback={<ViewerErrorFallback />}
          >
            <Canvas
              dpr={[1, Math.min(window.devicePixelRatio, 2)]}
              gl={{
                antialias: true,
                alpha: false,
                powerPreference: 'default',
                failIfMajorPerformanceCaveat: false,
                stencil: false,
              }}
              style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
            >
              <color attach="background" args={['#0f1629']} />
              <fog attach="fog" args={['#0a0e1a', 20, 50]} />
              <SceneContent />
            </Canvas>
          </ViewerErrorBoundary>
        </div>
      ) : (
        <WebGLUnavailable />
      )}

      {!loadedModel && !isLoading && webglOk && <EmptyState />}
      {isLoading && <LoadingOverlay />}

      {error && (
        <div className="absolute bottom-4 left-4 right-4 z-30">
          <div className="rounded-lg px-4 py-3 border border-red-500/30 bg-red-950/90">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}
