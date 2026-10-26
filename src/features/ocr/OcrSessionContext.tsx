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
import { countTaggedItems } from '@/lib/ocr/classifyOcrText'
import { mergeOcrPageResults } from '@/lib/ocr/mergeOcrPageResults'
import { releaseOcrWorker } from '@/lib/ocr/ocrWorkerPool'
import { OcrCancelledError, runPageOcr } from '@/lib/ocr/runPageOcr'
import { getOcrLanguagePack } from '@/lib/ocr/languages'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import type {
  OcrJobProgress,
  OcrLanguagePackId,
  OcrPageResult,
  OcrTextItem,
} from '@/types/ocr'
import type { PageRect } from '@/types'

interface OcrSessionContextValue {
  languageId: OcrLanguagePackId
  setLanguageId: (id: OcrLanguagePackId) => void
  job: OcrJobProgress
  pageResult: OcrPageResult | null
  correctedTextById: Readonly<Record<string, string>>
  setCorrectedText: (itemId: string, text: string) => void
  selectedItemId: string | null
  selectItem: (itemId: string | null) => void
  adjustmentBounds: PageRect | null
  setAdjustmentBounds: (bounds: PageRect | null) => void
  regionSelectActive: boolean
  setRegionSelectActive: (active: boolean) => void
  runOcrOnCurrentPage: () => void
  runOcrOnRegion: (bounds: PageRect) => void
  cancelOcr: () => void
  clearPageOcr: () => void
  priceMatchCount: number
  getSelectedItem: () => OcrTextItem | null
}

const OcrSessionContext = createContext<OcrSessionContextValue | null>(null)

interface OcrSessionProviderProps {
  activePageIndex: number
  children: ReactNode
}

const idleJob: OcrJobProgress = {
  status: 'idle',
  progress: 0,
  message: '',
  error: null,
}

export function OcrSessionProvider({
  activePageIndex,
  children,
}: OcrSessionProviderProps) {
  const { pdf, status, renderGeneration } = usePdfViewer()
  const [languageId, setLanguageIdState] = useState<OcrLanguagePackId>('eng')
  const [resultsByPage, setResultsByPage] = useState<
    Record<number, OcrPageResult>
  >({})
  const [job, setJob] = useState<OcrJobProgress>(idleJob)
  const [correctedTextById, setCorrectedTextById] = useState<
    Record<string, string>
  >({})
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [adjustmentBounds, setAdjustmentBounds] = useState<PageRect | null>(
    null,
  )
  const [regionSelectActive, setRegionSelectActive] = useState(false)
  const cancelRef = useRef(false)
  const runGenerationRef = useRef(0)

  const pageResult = resultsByPage[activePageIndex] ?? null

  useEffect(() => {
    return () => {
      void releaseOcrWorker()
    }
  }, [])

  useEffect(() => {
    setResultsByPage({})
    setCorrectedTextById({})
    setSelectedItemId(null)
    setAdjustmentBounds(null)
    setRegionSelectActive(false)
    setJob(idleJob)
    cancelRef.current = false
    void releaseOcrWorker()
  }, [renderGeneration])

  useEffect(() => {
    setSelectedItemId(null)
    setAdjustmentBounds(null)
  }, [activePageIndex])

  const setLanguageId = useCallback((id: OcrLanguagePackId) => {
    const pack = getOcrLanguagePack(id)
    if (!pack.available) {
      return
    }
    setLanguageIdState(id)
  }, [])

  const applyResult = useCallback((result: OcrPageResult) => {
    setResultsByPage((prev) => {
      const merged = mergeOcrPageResults(prev[result.pageIndex] ?? null, result)
      setCorrectedTextById((corrections) => {
        const next: Record<string, string> = {}
        for (const item of merged.items) {
          next[item.id] = corrections[item.id] ?? item.text
        }
        return next
      })
      return { ...prev, [result.pageIndex]: merged }
    })
  }, [])

  const startJob = useCallback(
    (regionBounds: PageRect | null) => {
      if (
        job.status === 'rendering' ||
        job.status === 'loading-worker' ||
        job.status === 'recognizing'
      ) {
        return
      }
      if (!pdf || status !== 'ready') {
        setJob({
          status: 'error',
          progress: 0,
          message: '',
          error: 'Open a PDF before running OCR.',
        })
        return
      }

      cancelRef.current = false
      const runGeneration = runGenerationRef.current + 1
      runGenerationRef.current = runGeneration
      setRegionSelectActive(false)
      setJob({
        status: 'rendering',
        progress: 0,
        message: regionBounds ? 'Preparing region…' : 'Preparing page…',
        error: null,
      })

      void (async () => {
        try {
          const result = await runPageOcr({
            pdf,
            pageIndex: activePageIndex,
            languageId,
            regionBounds,
            isCancelled: () =>
              cancelRef.current || runGenerationRef.current !== runGeneration,
            onPhase: (phase, message) => {
              if (runGenerationRef.current !== runGeneration) {
                return
              }
              setJob((prev) => ({
                ...prev,
                status: phase,
                message,
              }))
            },
            onProgress: (progress, statusText) => {
              if (runGenerationRef.current !== runGeneration) {
                return
              }
              setJob((prev) => ({
                ...prev,
                status: 'recognizing',
                progress,
                message: statusText,
              }))
            },
          })
          if (
            cancelRef.current ||
            runGenerationRef.current !== runGeneration
          ) {
            throw new OcrCancelledError()
          }
          applyResult(result)
          setJob({
            status: 'done',
            progress: 1,
            message: `Found ${result.items.length} text region${result.items.length === 1 ? '' : 's'}.`,
            error: null,
          })
        } catch (cause) {
          if (cause instanceof OcrCancelledError) {
            setJob({
              status: 'cancelled',
              progress: 0,
              message: 'OCR cancelled.',
              error: null,
            })
            return
          }
          const message =
            cause instanceof Error
              ? cause.message
              : 'OCR failed. Check your connection and try again.'
          setJob({
            status: 'error',
            progress: 0,
            message: '',
            error: message,
          })
        }
      })()
    },
    [pdf, status, activePageIndex, languageId, applyResult, job.status],
  )

  const runOcrOnCurrentPage = useCallback(() => {
    startJob(null)
  }, [startJob])

  const runOcrOnRegion = useCallback(
    (bounds: PageRect) => {
      startJob(bounds)
    },
    [startJob],
  )

  const cancelOcr = useCallback(() => {
    cancelRef.current = true
    runGenerationRef.current += 1
    setJob((prev) => ({
      ...prev,
      status: 'cancelled',
      message: 'Cancelling…',
    }))
    void releaseOcrWorker()
  }, [])

  const clearPageOcr = useCallback(() => {
    setResultsByPage((prev) => {
      const next = { ...prev }
      delete next[activePageIndex]
      return next
    })
    setCorrectedTextById((prev) => {
      const next = { ...prev }
      for (const item of pageResult?.items ?? []) {
        delete next[item.id]
      }
      return next
    })
    setSelectedItemId(null)
    setAdjustmentBounds(null)
    setJob(idleJob)
  }, [activePageIndex, pageResult?.items])

  const setCorrectedText = useCallback((itemId: string, text: string) => {
    setCorrectedTextById((prev) => ({ ...prev, [itemId]: text }))
  }, [])

  const selectItem = useCallback(
    (itemId: string | null) => {
      setSelectedItemId(itemId)
      if (!itemId || !pageResult) {
        setAdjustmentBounds(null)
        return
      }
      const item = pageResult.items.find((entry) => entry.id === itemId)
      setAdjustmentBounds(item?.bounds ?? null)
    },
    [pageResult],
  )

  const priceMatchCount = useMemo(
    () => countTaggedItems(pageResult?.items ?? [], 'price'),
    [pageResult],
  )

  const getSelectedItem = useCallback((): OcrTextItem | null => {
    if (!selectedItemId || !pageResult) {
      return null
    }
    return pageResult.items.find((item) => item.id === selectedItemId) ?? null
  }, [pageResult, selectedItemId])

  const value = useMemo<OcrSessionContextValue>(
    () => ({
      languageId,
      setLanguageId,
      job,
      pageResult,
      correctedTextById,
      setCorrectedText,
      selectedItemId,
      selectItem,
      adjustmentBounds,
      setAdjustmentBounds,
      regionSelectActive,
      setRegionSelectActive,
      runOcrOnCurrentPage,
      runOcrOnRegion,
      cancelOcr,
      clearPageOcr,
      priceMatchCount,
      getSelectedItem,
    }),
    [
      languageId,
      setLanguageId,
      job,
      pageResult,
      correctedTextById,
      setCorrectedText,
      selectedItemId,
      selectItem,
      adjustmentBounds,
      regionSelectActive,
      runOcrOnCurrentPage,
      runOcrOnRegion,
      cancelOcr,
      clearPageOcr,
      priceMatchCount,
      getSelectedItem,
    ],
  )

  return (
    <OcrSessionContext.Provider value={value}>{children}</OcrSessionContext.Provider>
  )
}

export function useOcrSession(): OcrSessionContextValue {
  const context = useContext(OcrSessionContext)
  if (!context) {
    throw new Error('useOcrSession must be used within OcrSessionProvider')
  }
  return context
}
