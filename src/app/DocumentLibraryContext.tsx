import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  deleteEditorSession,
  loadEditorSession,
} from '@/lib/persistence/editorSessionStore'
import {
  deletePdfFromIndexedDb,
  loadPdfFromIndexedDb,
  savePdfToIndexedDb,
} from '@/lib/persistence/pdfBlobStore'
import { clearAllLocalPersistence } from '@/lib/persistence/idb'
import { DEMO_DOCUMENTS } from '@/features/dashboard/demoDocuments'
import {
  createPdfSourceFromFile,
  inspectPdfDocument,
  PdfUserFacingError,
  toUserFacingPdfError,
} from '@/lib/pdf'
import type { PdfSource } from '@/types'
import type { DocumentRecord } from '@/types/documentRecord'

const STORAGE_KEY = 'smartpdf-studio:user-documents'

interface PersistedUserRecord {
  id: string
  name: string
  pageCount: number
  lastEditedAt: string
}

interface DocumentLibraryContextValue {
  demoDocuments: readonly DocumentRecord[]
  userDocuments: readonly DocumentRecord[]
  loading: boolean
  ingestError: string | null
  clearIngestError: () => void
  ingestFile: (file: File) => Promise<DocumentRecord | null>
  removeUserDocument: (id: string) => void
  getDocumentById: (id: string) => DocumentRecord | undefined
  getSourceForDocument: (id: string) => PdfSource | null
  renameDocument: (id: string, name: string) => void
  touchDocument: (id: string) => void
  clearAllLocalData: () => Promise<{ ok: boolean; message: string }>
  hydratingStorage: boolean
}

const DocumentLibraryContext =
  createContext<DocumentLibraryContextValue | null>(null)

function loadPersistedUserRecords(): DocumentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as PersistedUserRecord[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.map((item) => ({
      ...item,
      source: 'user' as const,
    }))
  } catch {
    return []
  }
}

function persistUserRecords(records: readonly DocumentRecord[]): void {
  const payload: PersistedUserRecord[] = records.map(
    ({ id, name, pageCount, lastEditedAt }) => ({
      id,
      name,
      pageCount,
      lastEditedAt,
    }),
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function DocumentLibraryProvider({ children }: { children: ReactNode }) {
  const [userDocuments, setUserDocuments] = useState<DocumentRecord[]>(() =>
    loadPersistedUserRecords(),
  )
  const [sessionSources, setSessionSources] = useState<
    Record<string, PdfSource>
  >({})
  const [loading, setLoading] = useState(false)
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [hydratingStorage, setHydratingStorage] = useState(false)

  const clearIngestError = useCallback(() => setIngestError(null), [])

  useEffect(() => {
    if (userDocuments.length === 0) {
      return
    }
    let cancelled = false
    setHydratingStorage(true)
    void (async () => {
      for (const doc of userDocuments) {
        if (cancelled) {
          continue
        }
        const loaded = await loadPdfFromIndexedDb(doc.id)
        if (loaded.ok && loaded.value) {
          setSessionSources((prev) =>
            prev[doc.id] ? prev : { ...prev, [doc.id]: loaded.value! },
          )
        }
      }
      if (!cancelled) {
        setHydratingStorage(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userDocuments])

  const getDocumentById = useCallback(
    (id: string): DocumentRecord | undefined => {
      const demo = DEMO_DOCUMENTS.find((doc) => doc.id === id)
      if (demo) {
        return demo
      }
      return userDocuments.find((doc) => doc.id === id)
    },
    [userDocuments],
  )

  const getSourceForDocument = useCallback(
    (id: string): PdfSource | null => sessionSources[id] ?? null,
    [sessionSources],
  )

  const ingestFile = useCallback(async (file: File) => {
    setLoading(true)
    setIngestError(null)
    try {
      const source = await createPdfSourceFromFile(file)
      const loaded = await inspectPdfDocument(source)
      const now = new Date().toISOString()
      const record: DocumentRecord = {
        id: loaded.id,
        name: file.name,
        pageCount: loaded.pageCount,
        lastEditedAt: now,
        source: 'user',
      }
      setSessionSources((prev) => ({ ...prev, [record.id]: source }))
      const pdfStoreResult = await savePdfToIndexedDb(record.id, source)
      if (!pdfStoreResult.ok) {
        setIngestError(pdfStoreResult.message)
      }
      setUserDocuments((prev) => {
        const withoutDup = prev.filter((doc) => doc.id !== record.id)
        const next = [record, ...withoutDup]
        persistUserRecords(next)
        return next
      })
      return record
    } catch (cause) {
      const message =
        cause instanceof PdfUserFacingError
          ? cause.message
          : toUserFacingPdfError(cause).message
      setIngestError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const removeUserDocument = useCallback((id: string) => {
    setUserDocuments((prev) => {
      const next = prev.filter((doc) => doc.id !== id)
      persistUserRecords(next)
      return next
    })
    setSessionSources((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    void (async () => {
      const loaded = await loadEditorSession(id)
      const assetIds =
        loaded.ok && loaded.value
          ? loaded.value.session.imageAssets.map((asset) => asset.id)
          : []
      await deletePdfFromIndexedDb(id)
      await deleteEditorSession(id, assetIds)
    })()
  }, [])

  const clearAllLocalData = useCallback(async (): Promise<{
    ok: boolean
    message: string
  }> => {
    const cleared = await clearAllLocalPersistence()
    if (!cleared.ok) {
      return { ok: false, message: cleared.message }
    }
    localStorage.removeItem(STORAGE_KEY)
    setUserDocuments([])
    setSessionSources({})
    return {
      ok: true,
      message: 'All local SmartPDF Studio data was removed from this browser.',
    }
  }, [])

  const renameDocument = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    setUserDocuments((prev) => {
      const next = prev.map((doc) =>
        doc.id === id ? { ...doc, name: trimmed } : doc,
      )
      persistUserRecords(next)
      return next
    })
  }, [])

  const touchDocument = useCallback((id: string) => {
    const now = new Date().toISOString()
    setUserDocuments((prev) => {
      const next = prev.map((doc) =>
        doc.id === id ? { ...doc, lastEditedAt: now } : doc,
      )
      persistUserRecords(next)
      return next
    })
  }, [])

  const value = useMemo<DocumentLibraryContextValue>(
    () => ({
      demoDocuments: DEMO_DOCUMENTS,
      userDocuments,
      loading,
      ingestError,
      clearIngestError,
      ingestFile,
      removeUserDocument,
      getDocumentById,
      getSourceForDocument,
      renameDocument,
      touchDocument,
      clearAllLocalData,
      hydratingStorage,
    }),
    [
      userDocuments,
      loading,
      ingestError,
      clearIngestError,
      ingestFile,
      removeUserDocument,
      getDocumentById,
      getSourceForDocument,
      renameDocument,
      touchDocument,
      clearAllLocalData,
      hydratingStorage,
    ],
  )

  return (
    <DocumentLibraryContext.Provider value={value}>
      {children}
    </DocumentLibraryContext.Provider>
  )
}

export function useDocumentLibrary(): DocumentLibraryContextValue {
  const ctx = useContext(DocumentLibraryContext)
  if (!ctx) {
    throw new Error('useDocumentLibrary must be used within DocumentLibraryProvider')
  }
  return ctx
}
