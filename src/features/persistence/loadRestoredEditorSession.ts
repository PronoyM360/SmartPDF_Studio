import { sanitizeRestoredOverlayFonts } from '@/lib/pdf/export/overlayFontResolution'
import { loadEditorSession } from '@/lib/persistence/editorSessionStore'
import type { RestoredEditorSessionPayload } from '@/features/persistence/restoreFromPersistedSession'

export type { RestoredEditorSessionPayload } from '@/features/persistence/restoreFromPersistedSession'

export async function loadRestoredEditorSession(
  documentId: string,
): Promise<RestoredEditorSessionPayload | null> {
  const loaded = await loadEditorSession(documentId)
  if (!loaded.ok) {
    return null
  }
  if (!loaded.value) {
    return null
  }
  const { session, imageBytesByAssetId } = loaded.value
  const imageAssets = session.imageAssets
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
      overlayObjects: sanitizeRestoredOverlayFonts(session.overlayObjects),
      imageAssets,
    },
    viewport: {
      activePage: session.activePage,
      zoomPercent: session.zoomPercent,
      fitMode: session.fitMode,
    },
    lastModifiedAt: session.lastModifiedAt,
    documentName: session.documentName,
  }
}
