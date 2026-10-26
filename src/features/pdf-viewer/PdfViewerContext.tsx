import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  openPdfDocument,
  readPageMeta,
  releasePdfDocument,
  toUserFacingPdfError,
} from '@/lib/pdf'
import type { PdfPageMeta, PdfSource } from '@/types'

export type PdfViewerStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'

interface PdfViewerContextValue {
  status: PdfViewerStatus
  error: string | null
  pdf: PDFDocumentProxy | null
  pageCount: number
  renderGeneration: number
  source: PdfSource | null
  getPageMeta: (pageIndex: number) => Promise<PdfPageMeta>
}

const PdfViewerContext = createContext<PdfViewerContextValue | null>(null)

interface PdfViewerProviderProps {
  source: PdfSource | null
  documentKey: string
  children: ReactNode
}

export function PdfViewerProvider({
  source,
  documentKey,
  children,
}: PdfViewerProviderProps) {
  const [status, setStatus] = useState<PdfViewerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [renderGeneration, setRenderGeneration] = useState(0)

  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const metaCacheRef = useRef<Map<number, PdfPageMeta>>(new Map())
  const metaInflightRef = useRef<Map<number, Promise<PdfPageMeta>>>(new Map())

  useEffect(() => {
    const abortController = new AbortController()
    metaCacheRef.current.clear()
    metaInflightRef.current.clear()
    setError(null)
    setPageCount(0)
    setPdf(null)
    pdfRef.current = null

    if (!source) {
      setStatus('idle')
      setRenderGeneration((value) => value + 1)
      return () => abortController.abort()
    }

    setStatus('loading')

    void (async () => {
      try {
        const opened = await openPdfDocument(
          source.originalBytes,
          abortController.signal,
        )
        if (abortController.signal.aborted) {
          await releasePdfDocument(opened.pdf)
          return
        }
        pdfRef.current = opened.pdf
        setPdf(opened.pdf)
        setPageCount(opened.pageCount)
        setStatus('ready')
        setRenderGeneration((value) => value + 1)
      } catch (cause) {
        if (abortController.signal.aborted) {
          return
        }
        const friendly = toUserFacingPdfError(cause)
        setError(friendly.message)
        setStatus('error')
        setRenderGeneration((value) => value + 1)
      }
    })()

    return () => {
      abortController.abort()
      const current = pdfRef.current
      pdfRef.current = null
      if (current) {
        void releasePdfDocument(current)
      }
      metaCacheRef.current.clear()
      metaInflightRef.current.clear()
    }
  }, [source, documentKey])

  const getPageMeta = useCallback(async (pageIndex: number) => {
    const activePdf = pdfRef.current
    if (!activePdf) {
      throw new Error('PDF is not loaded.')
    }
    const cached = metaCacheRef.current.get(pageIndex)
    if (cached) {
      return cached
    }
    const inflight = metaInflightRef.current.get(pageIndex)
    if (inflight) {
      return inflight
    }
    const task = readPageMeta(activePdf, pageIndex).then((meta) => {
      metaCacheRef.current.set(pageIndex, meta)
      metaInflightRef.current.delete(pageIndex)
      return meta
    })
    metaInflightRef.current.set(pageIndex, task)
    return task
  }, [])

  const value = useMemo<PdfViewerContextValue>(
    () => ({
      status,
      error,
      pdf,
      pageCount,
      renderGeneration,
      source,
      getPageMeta,
    }),
    [status, error, pdf, pageCount, renderGeneration, source, getPageMeta],
  )

  return (
    <PdfViewerContext.Provider value={value}>{children}</PdfViewerContext.Provider>
  )
}

export function usePdfViewer(): PdfViewerContextValue {
  const context = useContext(PdfViewerContext)
  if (!context) {
    throw new Error('usePdfViewer must be used within PdfViewerProvider')
  }
  return context
}
