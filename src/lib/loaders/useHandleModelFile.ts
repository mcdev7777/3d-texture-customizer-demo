import { useCallback, useRef } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { loadModelFromFile, parseFileType } from './loadModel'
import { teardownLoadedModel } from '../model/teardownModel'

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

export function useHandleModelFile() {
  const loadGenerationRef = useRef(0)
  const isLoading = useAppStore((s) => s.isLoading)
  const setLoading = useAppStore((s) => s.setLoading)
  const setError = useAppStore((s) => s.setError)
  const setLoadedModel = useAppStore((s) => s.setLoadedModel)

  return useCallback(
    async (file: File) => {
      if (isLoading) return

      const fileType = parseFileType(file.name)
      if (!fileType) {
        setError(
          `Unsupported file type "${file.name.split('.').pop() ?? ''}". Supported: .stl, .obj, .glb, .gltf, .3mf`,
        )
        return
      }

      const generation = ++loadGenerationRef.current
      setLoading(true)
      setError(null)
      await yieldToMain()

      const previousModel = useAppStore.getState().loadedModel

      try {
        const newModel = await loadModelFromFile(file)
        if (generation !== loadGenerationRef.current) {
          teardownLoadedModel(newModel)
          return
        }

        teardownLoadedModel(previousModel)
        setLoadedModel(newModel, file.name, fileType)
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load model.')
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false)
        }
      }
    },
    [isLoading, setLoading, setError, setLoadedModel],
  )
}
