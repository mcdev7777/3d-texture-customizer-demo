import { useRef } from 'react'
import { Upload, FileBox } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/useAppStore'
import { useHandleModelFile } from '../../lib/loaders/useHandleModelFile'
import { ACCEPTED_FILE_EXTENSIONS } from '../../types/model'

interface FileDropzoneProps {
  compact?: boolean
}

export function FileDropzone({ compact }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isLoading = useAppStore((s) => s.isLoading)
  const handleFile = useHandleModelFile()

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isLoading) return
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        className={clsx(
          'rounded-xl border-2 border-dashed border-purple-500/25 text-center',
          'transition-colors hover:border-purple-400/40 hover:bg-purple-950/30',
          compact ? 'p-3' : 'p-4',
        )}
      >
        <Upload className={clsx('mx-auto mb-2 text-purple-400', compact ? 'h-5 w-5' : 'h-6 w-6')} />
        {!compact && (
          <p className="text-xs text-slate-400 mb-3">Drag & drop a model here</p>
        )}
        <Button
          variant="primary"
          icon={<FileBox className="h-4 w-4" />}
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
          className={compact ? 'w-full text-xs' : undefined}
        >
          Open Model
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FILE_EXTENSIONS}
          className="hidden"
          onChange={onInputChange}
        />
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Supports .stl, .obj, .glb, .gltf, .3mf
      </p>
    </div>
  )
}
