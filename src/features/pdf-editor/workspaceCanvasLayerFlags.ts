import type { WorkspacePreviewMode } from '@/features/pdf-editor/EditorPreviewContext'

export interface WorkspaceCanvasLayerFlags {
  showCommittedOverlays: boolean
  showInspectLayers: boolean
  showPendingReplacement: boolean
}

/** Which Konva layers to show for a preview mode (single canvas or split pane). */
export function workspaceCanvasLayerFlags(
  previewMode: WorkspacePreviewMode,
  splitVariant?: 'original' | 'edited',
): WorkspaceCanvasLayerFlags {
  if (previewMode === 'original') {
    return {
      showCommittedOverlays: false,
      showInspectLayers: false,
      showPendingReplacement: false,
    }
  }

  if (previewMode === 'edited') {
    return {
      showCommittedOverlays: true,
      showInspectLayers: true,
      showPendingReplacement: true,
    }
  }

  const isEditedPane = splitVariant === 'edited'
  return {
    showCommittedOverlays: isEditedPane,
    showInspectLayers: isEditedPane,
    showPendingReplacement: isEditedPane,
  }
}
