export function getSurfaceId(meshUuid: string, faceIndex: number): string {
  return `${meshUuid}:${faceIndex}`
}

export function getSurfaceLabel(meshName: string, faceIndex: number): string {
  const name = meshName.trim() || 'Surface'
  return `${name} · ${faceIndex}`
}
