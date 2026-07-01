export function downloadBlob(
  data: string | ArrayBuffer | Blob,
  fileName: string,
  mimeType: string,
): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data], { type: mimeType })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
