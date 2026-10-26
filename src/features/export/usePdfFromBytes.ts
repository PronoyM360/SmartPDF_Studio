import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'
import { openPdfDocument, readPageMeta, releasePdfDocument } from '@/lib/pdf'
import type { PdfPageMeta } from '@/types'

export type BytesPdfStatus = 'idle' | 'loading' | 'ready' | 'error'

export function usePdfFromBytes(bytes: Uint8Array | null): {
  status: BytesPdfStatus
  error: string | null
  pageCount: number
  renderGeneration: number
  pdf: PDFDocumentProxy | null
  getPageMeta: (pageIndex: number) => Promise<PdfPageMeta>
} {
  const [status, setStatus] = useState<BytesPdfStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [renderGeneration, setRenderGeneration] = useState(0)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const metaCacheRef = useRef<Map<number, PdfPageMeta>>(new Map())

  useEffect(() => {
    metaCacheRef.current.clear()
    const current = pdfRef.current
    pdfRef.current = null
    if (current) {
      void releasePdfDocument(current)
    }
    setPdf(null)

    if (!bytes || bytes.byteLength === 0) {
      setStatus('idle')
      setError(null)
      setPageCount(0)
      setRenderGeneration((value) => value + 1)
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    void (async () => {
      try {
        const opened = await openPdfDocument(bytes.slice())
        if (cancelled) {
          await releasePdfDocument(opened.pdf)
          return
        }
        pdfRef.current = opened.pdf
        setPdf(opened.pdf)
        setPageCount(opened.pageCount)
        setStatus('ready')
        setRenderGeneration((value) => value + 1)
      } catch (cause) {
        if (cancelled) {
          return
        }
        setError(
          cause instanceof Error ? cause.message : 'Could not open exported PDF.',
        )
        setStatus('error')
        setRenderGeneration((value) => value + 1)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bytes])

  const getPageMeta = useCallback(async (pageIndex: number): Promise<PdfPageMeta> => {
    const pdf = pdfRef.current
    if (!pdf) {
      throw new Error('Exported PDF is not loaded.')
    }
    const cached = metaCacheRef.current.get(pageIndex)
    if (cached) {
      return cached
    }
    const meta = await readPageMeta(pdf, pageIndex)
    metaCacheRef.current.set(pageIndex, meta)
    return meta
  }, [])

  return { status, error, pageCount, renderGeneration, pdf, getPageMeta }
}
