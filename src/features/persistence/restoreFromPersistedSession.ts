import { sanitizeRestoredOverlayFonts } from '@/lib/pdf/export/overlayFontResolution'
import { loadImageBytesForSessionAssets } from '@/lib/persistence/editorSessionStore'
import type { RestoredEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import type { PersistedEditorSession } from '@/types/persistedSession'

export interface RestoredEditorSessionPayload {
  session: RestoredEditorSession
  viewport: {
    activePage: number
    zoomPercent: number
    fitMode: FitMode
  }
  lastModifiedAt: string
  documentName?: string
}

export async function restoreFromPersistedSession(
  persisted: PersistedEditorSession,
): Promise<RestoredEditorSessionPayload | null> {
  const bytesResult = await loadImageBytesForSessionAssets(
    persisted.documentId,
    persisted.imageAssets,
  )
  if (!bytesResult.ok) {
    return null
  }
  const imageBytesByAssetId = bytesResult.value
  const imageAssets = persisted.imageAssets
    .map((meta) => {
      const bytes = imageBytesByAssetId[meta.id]
      if (!bytes) {
        return null
      }
      return {
        id: meta.id,
        mimeType: meta.mimeType,
        pixelWidth: meta.pixelWidth,
        pixelHeight: meta.pixelHeight,
        bytes,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  return {
    session: {
      overlayObjects: sanitizeRestoredOverlayFonts(persisted.overlayObjects),
      imageAssets,
    },
    viewport: {
      activePage: persisted.activePage,
      zoomPercent: persisted.zoomPercent,
      fitMode: persisted.fitMode,
    },
    lastModifiedAt: persisted.lastModifiedAt,
    documentName: persisted.documentName,
  }
}
