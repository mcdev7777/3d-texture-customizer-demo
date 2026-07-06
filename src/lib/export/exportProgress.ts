export type ExportProgressCallback = (fraction: number, label: string) => void

export interface ExportProgressState {
  fraction: number
  label: string
}

let lastYieldTime = 0

/** Yield so the browser can paint and handle input (non-blocking export). */
export function yieldToMain(): Promise<void> {
  lastYieldTime = performance.now()
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

/**
 * Yield when enough wall time has passed — call inside hot loops so export stays
 * responsive without yielding on every iteration.
 */
export async function yieldIfBusy(thresholdMs = 12): Promise<void> {
  const now = performance.now()
  if (now - lastYieldTime >= thresholdMs) {
    await yieldToMain()
  }
}

export function clampProgress(fraction: number): number {
  return Math.min(1, Math.max(0, fraction))
}

/** Run an indexed loop, yielding periodically. */
export async function forEachWithYield<T>(
  items: readonly T[],
  chunkSize: number,
  fn: (item: T, index: number) => void | Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await fn(items[i]!, i)
    if (i > 0 && i % chunkSize === 0) {
      await yieldIfBusy()
    }
  }
}
