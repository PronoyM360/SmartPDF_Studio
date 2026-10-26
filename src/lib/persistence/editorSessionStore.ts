import {
  clearRecoveryDraft,
  recoverySessionKey,
} from '@/lib/persistence/recoverySession'
import {
  idbDelete,
  idbGet,
  idbPut,
  STORE_EDITOR_SESSIONS,
  STORE_IMAGE_ASSETS,
  type StorageResult,
} from '@/lib/persistence/idb'
import {
  PERSISTENCE_SCHEMA_VERSION,
  type PersistedEditorSession,
  type PersistedImageAssetMeta,
} from '@/types/persistedSession'
import type { OverlayObject } from '@/types/overlayObjects'

function imageAssetKey(documentId: string, assetId: string): string {
  return `${documentId}::${assetId}`
}

export function validatePersistedSession(
  raw: unknown,
): PersistedEditorSession | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as PersistedEditorSession
  if (value.schemaVersion !== PERSISTENCE_SCHEMA_VERSION) {
    return null
  }
  if (!value.documentId || !Array.isArray(value.overlayObjects)) {
    return null
  }
  return value
}

async function writeImageAssets(
  session: PersistedEditorSession,
  imageBytesByAssetId: Readonly<Record<string, Uint8Array>>,
  skipExisting: boolean,
): Promise<StorageResult<void>> {
  for (const meta of session.imageAssets) {
    const bytes = imageBytesByAssetId[meta.id]
    if (!bytes) {
      continue
    }
    const assetKey = imageAssetKey(session.documentId, meta.id)
    if (skipExisting) {
      const existing = await idbGet<{ meta: PersistedImageAssetMeta; bytes: ArrayBuffer }>(
        STORE_IMAGE_ASSETS,
        assetKey,
      )
      if (existing.ok && existing.value?.bytes?.byteLength) {
        continue
      }
    }
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const putResult = await idbPut(STORE_IMAGE_ASSETS, assetKey, {
      meta,
      bytes: buffer,
    })
    if (!putResult.ok) {
      return putResult
    }
  }
  return { ok: true, value: undefined }
}

export async function saveMissingImageAssets(
  session: PersistedEditorSession,
  imageBytesByAssetId: Readonly<Record<string, Uint8Array>>,
): Promise<StorageResult<void>> {
  return writeImageAssets(session, imageBytesByAssetId, true)
}

export async function saveEditorSession(
  session: PersistedEditorSession,
  imageBytesByAssetId: Readonly<Record<string, Uint8Array>>,
  options?: { skipExistingImageAssets?: boolean },
): Promise<StorageResult<void>> {
  const sessionResult = await idbPut(
    STORE_EDITOR_SESSIONS,
    session.documentId,
    session,
  )
  if (!sessionResult.ok) {
    return sessionResult
  }

  const imageResult = await writeImageAssets(
    session,
    imageBytesByAssetId,
    options?.skipExistingImageAssets ?? false,
  )
  if (!imageResult.ok) {
    return imageResult
  }

  const cleared = await clearRecoveryDraft(session.documentId)
  if (!cleared.ok) {
    return cleared
  }

  return { ok: true, value: undefined }
}

export async function loadEditorSession(
  documentId: string,
): Promise<
  StorageResult<{
    session: PersistedEditorSession
    imageBytesByAssetId: Record<string, Uint8Array>
  } | null>
> {
  const sessionResult = await idbGet<PersistedEditorSession>(
    STORE_EDITOR_SESSIONS,
    documentId,
  )
  if (!sessionResult.ok) {
    return sessionResult
  }
  const validated = validatePersistedSession(sessionResult.value)
  if (!validated) {
    return { ok: true, value: null }
  }

  const imageBytesByAssetId: Record<string, Uint8Array> = {}
  for (const meta of validated.imageAssets) {
    const assetResult = await idbGet<{
      meta: PersistedImageAssetMeta
      bytes: ArrayBuffer
    }>(STORE_IMAGE_ASSETS, imageAssetKey(documentId, meta.id))
    if (assetResult.ok && assetResult.value?.bytes) {
      imageBytesByAssetId[meta.id] = new Uint8Array(assetResult.value.bytes)
    }
  }

  return {
    ok: true,
    value: { session: validated, imageBytesByAssetId },
  }
}

export async function deleteEditorSession(
  documentId: string,
  assetIds: readonly string[],
): Promise<StorageResult<void>> {
  const sessionDelete = await idbDelete(STORE_EDITOR_SESSIONS, documentId)
  if (!sessionDelete.ok) {
    return sessionDelete
  }
  for (const assetId of assetIds) {
    await idbDelete(STORE_IMAGE_ASSETS, imageAssetKey(documentId, assetId))
  }
  await idbDelete(STORE_EDITOR_SESSIONS, recoverySessionKey(documentId))
  return { ok: true, value: undefined }
}

export async function loadImageBytesForSessionAssets(
  documentId: string,
  imageAssets: readonly PersistedImageAssetMeta[],
): Promise<StorageResult<Record<string, Uint8Array>>> {
  const imageBytesByAssetId: Record<string, Uint8Array> = {}
  for (const meta of imageAssets) {
    const assetResult = await idbGet<{
      meta: PersistedImageAssetMeta
      bytes: ArrayBuffer
    }>(STORE_IMAGE_ASSETS, imageAssetKey(documentId, meta.id))
    if (assetResult.ok && assetResult.value?.bytes) {
      imageBytesByAssetId[meta.id] = new Uint8Array(assetResult.value.bytes)
    }
  }
  return { ok: true, value: imageBytesByAssetId }
}

export async function loadPersistedEditorSession(
  documentId: string,
): Promise<StorageResult<PersistedEditorSession | null>> {
  const sessionResult = await idbGet<PersistedEditorSession>(
    STORE_EDITOR_SESSIONS,
    documentId,
  )
  if (!sessionResult.ok) {
    return sessionResult
  }
  return { ok: true, value: validatePersistedSession(sessionResult.value) }
}

export function buildPersistedSession(input: {
  documentId: string
  documentName?: string
  overlayObjects: readonly OverlayObject[]
  imageAssets: readonly PersistedImageAssetMeta[]
  activePage: number
  zoomPercent: number
  fitMode: 'page' | 'width'
}): PersistedEditorSession {
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    documentId: input.documentId,
    documentName: input.documentName?.trim() || undefined,
    lastModifiedAt: new Date().toISOString(),
    activePage: input.activePage,
    zoomPercent: input.zoomPercent,
    fitMode: input.fitMode,
    overlayObjects: JSON.parse(JSON.stringify(input.overlayObjects)) as OverlayObject[],
    imageAssets: [...input.imageAssets],
  }
}
