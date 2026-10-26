import {
  idbDelete,
  idbGet,
  idbPut,
  STORE_EDITOR_SESSIONS,
  type StorageResult,
} from '@/lib/persistence/idb'
import { validatePersistedSession } from '@/lib/persistence/editorSessionStore'
import type { PersistedEditorSession } from '@/types/persistedSession'

const RECOVERY_SUFFIX = '::__recovery__'

export function recoverySessionKey(documentId: string): string {
  return `${documentId}${RECOVERY_SUFFIX}`
}

export function isRecoverySessionKey(key: string): boolean {
  return key.endsWith(RECOVERY_SUFFIX)
}

export function documentIdFromRecoveryKey(key: string): string {
  return key.slice(0, -RECOVERY_SUFFIX.length)
}

export function recoveryIsNewerThanSaved(
  saved: PersistedEditorSession | null,
  recovery: PersistedEditorSession | null,
): boolean {
  if (!recovery) {
    return false
  }
  if (!saved) {
    return true
  }
  return (
    new Date(recovery.lastModifiedAt).getTime() >
    new Date(saved.lastModifiedAt).getTime()
  )
}

export async function saveRecoveryDraft(
  session: PersistedEditorSession,
): Promise<StorageResult<void>> {
  return idbPut(STORE_EDITOR_SESSIONS, recoverySessionKey(session.documentId), session)
}

export async function loadRecoveryDraft(
  documentId: string,
): Promise<StorageResult<PersistedEditorSession | null>> {
  const result = await idbGet<PersistedEditorSession>(
    STORE_EDITOR_SESSIONS,
    recoverySessionKey(documentId),
  )
  if (!result.ok) {
    return result
  }
  return { ok: true, value: validatePersistedSession(result.value) }
}

export async function clearRecoveryDraft(
  documentId: string,
): Promise<StorageResult<void>> {
  return idbDelete(STORE_EDITOR_SESSIONS, recoverySessionKey(documentId))
}
