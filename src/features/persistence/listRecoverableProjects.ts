import {
  loadPersistedEditorSession,
} from '@/lib/persistence/editorSessionStore'
import {
  loadRecoveryDraft,
  recoveryIsNewerThanSaved,
} from '@/lib/persistence/recoverySession'
import type { DocumentRecord } from '@/types/documentRecord'

export interface RecoverableProjectSummary {
  readonly documentId: string
  readonly documentName: string
  readonly recoveryAt: string
  readonly savedAt: string | null
}

export async function listRecoverableProjects(
  userDocuments: readonly DocumentRecord[],
): Promise<RecoverableProjectSummary[]> {
  const results: RecoverableProjectSummary[] = []
  for (const doc of userDocuments) {
    const [savedResult, recoveryResult] = await Promise.all([
      loadPersistedEditorSession(doc.id),
      loadRecoveryDraft(doc.id),
    ])
    if (!recoveryResult.ok || !recoveryResult.value) {
      continue
    }
    const saved = savedResult.ok ? savedResult.value : null
    if (!recoveryIsNewerThanSaved(saved, recoveryResult.value)) {
      continue
    }
    results.push({
      documentId: doc.id,
      documentName: recoveryResult.value.documentName ?? doc.name,
      recoveryAt: recoveryResult.value.lastModifiedAt,
      savedAt: saved?.lastModifiedAt ?? null,
    })
  }
  return results
}
