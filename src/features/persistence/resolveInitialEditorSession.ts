import { loadPersistedEditorSession } from '@/lib/persistence/editorSessionStore'
import {
  loadRecoveryDraft,
  recoveryIsNewerThanSaved,
} from '@/lib/persistence/recoverySession'
import { loadRestoredEditorSession } from '@/features/persistence/loadRestoredEditorSession'
import type { RestoredEditorSessionPayload } from '@/features/persistence/restoreFromPersistedSession'
import type { PersistedEditorSession } from '@/types/persistedSession'

export type InitialEditorSessionResult =
  | { kind: 'empty' }
  | { kind: 'ready'; payload: RestoredEditorSessionPayload }
  | {
      kind: 'recover'
      recovery: PersistedEditorSession
      savedAt: string | null
      savedPayload: RestoredEditorSessionPayload | null
      documentName: string
    }

export async function resolveInitialEditorSession(
  documentId: string,
  fallbackDocumentName: string,
): Promise<InitialEditorSessionResult> {
  const [savedPersistedResult, recoveryResult, savedPayload] = await Promise.all([
    loadPersistedEditorSession(documentId),
    loadRecoveryDraft(documentId),
    loadRestoredEditorSession(documentId),
  ])

  const savedPersisted =
    savedPersistedResult.ok ? savedPersistedResult.value : null
  const recovery =
    recoveryResult.ok ? recoveryResult.value : null

  if (recovery && recoveryIsNewerThanSaved(savedPersisted, recovery)) {
    return {
      kind: 'recover',
      recovery,
      savedAt: savedPersisted?.lastModifiedAt ?? null,
      savedPayload,
      documentName:
        recovery.documentName ?? savedPersisted?.documentName ?? fallbackDocumentName,
    }
  }

  if (savedPayload) {
    return { kind: 'ready', payload: savedPayload }
  }

  return { kind: 'empty' }
}
