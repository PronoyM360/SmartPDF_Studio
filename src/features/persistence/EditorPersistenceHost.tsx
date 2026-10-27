import { message } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocumentLibrary } from '@/app/DocumentLibraryContext'
import {
  buildPersistedSession,
  loadPersistedEditorSession,
  saveEditorSession,
  saveMissingImageAssets,
} from '@/lib/persistence/editorSessionStore'
import { ensurePdfStoredInIndexedDb } from '@/lib/persistence/pdfBlobStore'
import {
  saveRecoveryDraft,
} from '@/lib/persistence/recoverySession'
import type { StorageResult } from '@/lib/persistence/idb'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import type { PersistedImageAssetMeta } from '@/types/persistedSession'
import type { PdfSource } from '@/types'

interface EditorPersistenceHostProps {
  documentId: string
  documentName: string
  pdfSource: PdfSource | null
  enabled: boolean
  activePage: number
  zoomPercent: number
  fitMode: FitMode
  /** Bumps when restored session is applied so dirty baseline matches loaded overlays. */
  sessionBaseline: number
  onSaveStatusChange?: (status: EditorSaveStatus) => void
  onSaveReady?: (saveNow: () => Promise<StorageResult<void>>) => void
}

export interface EditorSaveStatus {
  readonly isDirty: boolean
  readonly lastSavedAt: string | null
  readonly lastError: string | null
  readonly isSaving: boolean
}

const SAVE_DEBOUNCE_MS = 1200
const RECOVERY_DEBOUNCE_MS = 600

export function EditorPersistenceHost({
  documentId,
  documentName,
  pdfSource,
  enabled,
  activePage,
  zoomPercent,
  fitMode,
  sessionBaseline,
  onSaveStatusChange,
  onSaveReady,
}: EditorPersistenceHostProps) {
  const { overlayObjects, collectImageAssetBytes, getImageAsset } = useEditorSession()
  const { touchDocument } = useDocumentLibrary()
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const saveTimerRef = useRef<number | null>(null)
  const recoveryTimerRef = useRef<number | null>(null)
  const lastSnapshotRef = useRef<string>('')

  const buildImageAssets = useCallback((): PersistedImageAssetMeta[] => {
    const imageBytes = collectImageAssetBytes()
    return Object.keys(imageBytes).map((id) => {
      const asset = getImageAsset(id)
      return {
        id,
        mimeType: asset?.mimeType ?? 'image/png',
        pixelWidth: asset?.pixelWidth ?? 0,
        pixelHeight: asset?.pixelHeight ?? 0,
      }
    })
  }, [collectImageAssetBytes, getImageAsset])

  const buildSession = useCallback(() => {
    return buildPersistedSession({
      documentId,
      documentName,
      overlayObjects,
      imageAssets: buildImageAssets(),
      activePage,
      zoomPercent,
      fitMode,
    })
  }, [
    documentId,
    documentName,
    overlayObjects,
    buildImageAssets,
    activePage,
    zoomPercent,
    fitMode,
  ])

  const buildSnapshot = useCallback((): string => {
    return JSON.stringify({
      overlayObjects,
      activePage,
      zoomPercent,
      fitMode,
      documentName,
    })
  }, [overlayObjects, activePage, zoomPercent, fitMode, documentName])
  const buildSnapshotRef = useRef(buildSnapshot)
  useEffect(() => {
    buildSnapshotRef.current = buildSnapshot
  }, [buildSnapshot])

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    void loadPersistedEditorSession(documentId).then((result) => {
      if (cancelled || !result.ok || !result.value) {
        return
      }
      setLastSavedAt(result.value.lastModifiedAt)
    })
    return () => {
      cancelled = true
    }
  }, [documentId, enabled])

  const persistNow = useCallback(async (): Promise<StorageResult<void>> => {
    if (!enabled) {
      return { ok: true, value: undefined }
    }

    if (pdfSource) {
      const pdfResult = await ensurePdfStoredInIndexedDb(documentId, pdfSource)
      if (!pdfResult.ok) {
        setLastError(pdfResult.message)
        message.warning(pdfResult.message)
        return pdfResult
      }
    }

    const session = buildSession()
    const imageBytes = collectImageAssetBytes()

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (recoveryTimerRef.current) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }

    setIsSaving(true)
    const result = await saveEditorSession(session, imageBytes, {
      skipExistingImageAssets: true,
    })
    setIsSaving(false)

    if (result.ok) {
      setLastSavedAt(session.lastModifiedAt)
      setLastError(null)
      setIsDirty(false)
      lastSnapshotRef.current = buildSnapshot()
      touchDocument(documentId)
    } else {
      setLastError(result.message)
      message.warning(result.message)
    }
    return result
  }, [
    enabled,
    pdfSource,
    documentId,
    buildSession,
    collectImageAssetBytes,
    buildSnapshot,
    touchDocument,
  ])

  const writeRecoveryDraft = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return
    }
    const session = buildSession()
    const imageBytes = collectImageAssetBytes()
    await saveMissingImageAssets(session, imageBytes)
    await saveRecoveryDraft(session)
  }, [enabled, buildSession, collectImageAssetBytes])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const snapshot = buildSnapshot()
    if (snapshot === lastSnapshotRef.current) {
      return
    }
    setIsDirty(true)
    if (recoveryTimerRef.current) {
      window.clearTimeout(recoveryTimerRef.current)
    }
    recoveryTimerRef.current = window.setTimeout(() => {
      void writeRecoveryDraft()
    }, RECOVERY_DEBOUNCE_MS)

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void persistNow()
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
      if (recoveryTimerRef.current) {
        window.clearTimeout(recoveryTimerRef.current)
      }
    }
  }, [enabled, buildSnapshot, persistNow, writeRecoveryDraft])

  useEffect(() => {
    onSaveStatusChange?.({
      isDirty,
      lastSavedAt,
      lastError,
      isSaving,
    })
  }, [isDirty, lastSavedAt, lastError, isSaving, onSaveStatusChange])

  useEffect(() => {
    if (!enabled) {
      return
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (recoveryTimerRef.current) {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = null
    }
    // Only a new document or restored session resets the baseline; depending on the
    // snapshot itself would treat every edit as already saved and cancel autosave.
    lastSnapshotRef.current = buildSnapshotRef.current()
    setIsDirty(false)
  }, [documentId, sessionBaseline, enabled])

  useEffect(() => {
    onSaveReady?.(persistNow)
  }, [onSaveReady, persistNow])

  return null
}
