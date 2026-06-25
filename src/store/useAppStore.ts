import { create } from 'zustand'
import type {
  CameraActions,
  LoadedModel,
  ModelStats,
  SupportedFileType,
  ViewerSettings,
} from '../types/model'

interface AppState {
  loadedModel: LoadedModel | null
  fileName: string | null
  fileType: SupportedFileType | null
  modelStats: ModelStats | null
  viewerSettings: ViewerSettings
  isLoading: boolean
  error: string | null
  cameraActions: CameraActions | null

  setLoadedModel: (
    model: LoadedModel | null,
    fileName: string | null,
    fileType: SupportedFileType | null,
  ) => void
  setViewerSetting: <K extends keyof ViewerSettings>(
    key: K,
    value: ViewerSettings[K],
  ) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setCameraActions: (actions: CameraActions | null) => void
  clearModel: () => void
}

const defaultViewerSettings: ViewerSettings = {
  showGrid: true,
  showAxes: false,
  showWireframe: false,
  showBoundingBox: false,
}

export const useAppStore = create<AppState>((set) => ({
  loadedModel: null,
  fileName: null,
  fileType: null,
  modelStats: null,
  viewerSettings: { ...defaultViewerSettings },
  isLoading: false,
  error: null,
  cameraActions: null,

  setLoadedModel: (model, fileName, fileType) =>
    set({
      loadedModel: model,
      fileName,
      fileType,
      modelStats: model?.stats ?? null,
      error: null,
    }),

  setViewerSetting: (key, value) =>
    set((state) => ({
      viewerSettings: { ...state.viewerSettings, [key]: value },
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error, isLoading: false }),

  setCameraActions: (actions) => set({ cameraActions: actions }),

  clearModel: () =>
    set({
      loadedModel: null,
      fileName: null,
      fileType: null,
      modelStats: null,
      error: null,
    }),
}))
