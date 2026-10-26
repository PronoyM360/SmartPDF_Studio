import { useCallback, useState } from 'react'
import {
  createPdfSourceFromFile,
  inspectPdfDocument,
} from '@/lib/pdf'
import type { LoadedPdfDocument, PdfSource } from '@/types'

export interface UsePdfDocumentResult {
  source: PdfSource | null
  document: LoadedPdfDocument | null
  error: string | null
  loading: boolean
  loadFromFile: (file: File) => Promise<void>
  clear: () => void
}

export function usePdfDocument(): UsePdfDocumentResult {
  const [source, setSource] = useState<PdfSource | null>(null)
  const [document, setDocument] = useState<LoadedPdfDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadFromFile = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const nextSource = await createPdfSourceFromFile(file)
      const loaded = await inspectPdfDocument(nextSource)
      setSource(nextSource)
      setDocument(loaded)
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to load PDF.'
      setError(message)
      setSource(null)
      setDocument(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setSource(null)
    setDocument(null)
    setError(null)
  }, [])

  return {
    source,
    document,
    error,
    loading,
    loadFromFile,
    clear,
  }
}
