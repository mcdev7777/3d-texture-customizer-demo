/** Normalize file names for comparison (case-insensitive, trimmed). */
export function normalizeModelFileName(name: string): string {
  return name.trim().toLowerCase()
}

export function modelFileNamesMatch(saved?: string, current?: string | null): boolean {
  if (!saved || !current) return false
  return normalizeModelFileName(saved) === normalizeModelFileName(current)
}

export function variationModelMismatchMessage(
  variationSource: string | undefined,
  currentFileName: string | null,
): string {
  const saved = variationSource ?? 'another model'
  const current = currentFileName ?? 'the current model'
  return `This variation was saved for "${saved}", but the loaded model is "${current}". Load the same file, or save a new variation for this model.`
}

export function assertVariationMatchesLoadedModel(
  variationSource: string | undefined,
  currentFileName: string | null,
): void {
  if (!variationSource || !currentFileName) return
  if (!modelFileNamesMatch(variationSource, currentFileName)) {
    throw new Error(variationModelMismatchMessage(variationSource, currentFileName))
  }
}
