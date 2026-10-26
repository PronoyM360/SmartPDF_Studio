import type { EditorToolId } from '@/types'

export function overlayManipulationEnabled(activeToolId: EditorToolId): boolean {
  return activeToolId === 'select'
}

export function overlaySelectionEnabled(
  activeToolId: EditorToolId,
  pendingImageAssetId: string | null,
): boolean {
  if (activeToolId === 'select' || activeToolId === 'text') {
    return true
  }
  if (activeToolId === 'image') {
    return !pendingImageAssetId
  }
  return false
}

export function overlayObjectsListen(
  activeToolId: EditorToolId,
  pendingImageAssetId: string | null,
): boolean {
  if (activeToolId === 'pan' || activeToolId === 'export') {
    return false
  }
  if (activeToolId === 'highlight') {
    return false
  }
  if (activeToolId === 'image' && pendingImageAssetId) {
    return false
  }
  return true
}
