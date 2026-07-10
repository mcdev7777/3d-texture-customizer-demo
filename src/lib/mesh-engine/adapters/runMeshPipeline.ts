import { runExportPipeline } from '../exportPipeline.js'
import type {
  PipelineEventHandler,
  PipelineInput,
  PipelineResult,
} from '../exportPipeline'
import type { ExportProgressCallback } from '../../export/exportProgress'

let pipelineWorker: Worker | null = null
let pipelineWorkerFailed = false
let pipelineWorkerInit: Promise<Worker | null> | null = null

export function ensurePipelineWorker(): Promise<Worker | null> {
  if (pipelineWorkerFailed) return Promise.resolve(null)
  if (pipelineWorker) return Promise.resolve(pipelineWorker)
  if (!pipelineWorkerInit) {
    pipelineWorkerInit = initPipelineWorker().then(
      (w) => {
        pipelineWorker = w
        pipelineWorkerInit = null
        return w
      },
      (err) => {
        pipelineWorkerFailed = true
        pipelineWorkerInit = null
        console.warn(
          '[mesh-engine] export worker unavailable — running pipeline on the main thread:',
          err instanceof Error ? err.message : String(err),
        )
        return null
      },
    )
  }
  return pipelineWorkerInit
}

function initPipelineWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    let w: Worker
    try {
      w = new Worker(new URL('../exportWorker.js', import.meta.url), { type: 'module' })
    } catch (err) {
      reject(err)
      return
    }
    const fail = (msg: string) => {
      try {
        w.terminate()
      } catch {
        /* ignore */
      }
      reject(new Error(msg))
    }
    const timer = setTimeout(() => fail('worker init timeout'), 20_000)
    w.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'ready') {
        clearTimeout(timer)
        w.onmessage = null
        w.onerror = null
        resolve(w)
      }
    }
    w.onerror = (e) => {
      clearTimeout(timer)
      fail((e as ErrorEvent).message || 'worker failed to load')
    }
  })
}

/** Idle-time worker warmup — call once on app load. */
export function warmupPipelineWorker(): void {
  const warm = () => {
    void ensurePipelineWorker()
  }
  const schedule = () => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(warm, { timeout: 8000 })
    } else {
      setTimeout(warm, 3000)
    }
  }
  if (document.readyState === 'complete') schedule()
  else window.addEventListener('load', schedule, { once: true })
}

const STAGE_FRACTIONS: Record<string, [number, number]> = {
  subdivide1: [0.05, 0.33],
  regularize: [0.33, 0.36],
  subdivide2: [0.36, 0.42],
  displace: [0.42, 0.72],
  decimate: [0.72, 0.85],
  smooth: [0.85, 0.9],
  repair: [0.9, 0.94],
}

function stageLabel(stage: string, info?: Record<string, unknown>): string {
  switch (stage) {
    case 'subdivide1':
    case 'subdivide2':
      return info?.triCount != null
        ? `Refining mesh (${Number(info.triCount).toLocaleString()} triangles)…`
        : 'Subdividing mesh…'
    case 'regularize':
      return 'Regularizing mesh…'
    case 'displace':
      return info?.triCount != null && info.triCount !== undefined
        ? `Applying displacement (${Number(info.triCount).toLocaleString()} triangles)…`
        : 'Displacing vertices…'
    case 'decimate':
      return 'Decimating mesh…'
    case 'smooth':
      return 'Smoothing surface…'
    case 'repair':
      return 'Repairing mesh…'
    default:
      return 'Processing mesh…'
  }
}

export function mapPipelineProgress(
  onProgress: ExportProgressCallback | undefined,
  meshIndex: number,
  meshCount: number,
): PipelineEventHandler {
  const meshSpan = 1 / Math.max(meshCount, 1)
  const meshBase = meshIndex * meshSpan

  return (stage, p, info) => {
    const range = STAGE_FRACTIONS[stage] ?? [0.5, 0.9]
    const local = range[0]! + (range[1]! - range[0]!) * p
    const fraction = meshBase + local * meshSpan
    onProgress?.(fraction, stageLabel(stage, info))
  }
}

export async function runMeshPipeline(
  input: PipelineInput,
  onEvent: PipelineEventHandler,
  isStale: () => boolean,
): Promise<PipelineResult | null> {
  const w = await ensurePipelineWorker()
  if (isStale()) return null
  if (!w) {
    return runExportPipeline(input, onEvent, isStale)
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.onmessage = null
      w.onerror = null
    }
    const kill = () => {
      cleanup()
      try {
        w.terminate()
      } catch {
        /* ignore */
      }
      pipelineWorker = null
    }

    w.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (isStale()) {
        kill()
        resolve(null)
        return
      }
      if (m.type === 'progress') onEvent(m.stage, m.p, m.info)
      else if (m.type === 'done') {
        cleanup()
        resolve(m.result ?? null)
      } else if (m.type === 'error') {
        cleanup()
        reject(new Error(m.message))
      }
    }
    w.onerror = (e) => {
      kill()
      reject(new Error((e as ErrorEvent).message || 'export worker crashed'))
    }
    w.postMessage({ cmd: 'run', input })
  })
}

export function abortPipelineWorker(): void {
  if (pipelineWorker) {
    try {
      pipelineWorker.terminate()
    } catch {
      /* ignore */
    }
    pipelineWorker = null
  }
}
