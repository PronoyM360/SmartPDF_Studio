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
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { searchExtractedTextItems } from '@/features/text-tools/searchPdfText'
import type {
  ExtractedPdfTextItem,
  PdfTextSearchResult,
} from '@/types/pdfTextInspection'
import type { PageRect } from '@/types'

interface PdfTextInspectContextValue {
  loading: boolean
  error: string | null
  pageItems: readonly ExtractedPdfTextItem[]
  allItems: readonly ExtractedPdfTextItem[]
  searchQuery: string
  setSearchQuery: (query: string) => void
  searchScope: 'page' | 'document'
  setSearchScope: (scope: 'page' | 'document') => void
  searchResults: readonly PdfTextSearchResult[]
  activeResultIndex: number
  activeSearchResult: PdfTextSearchResult | null
  focusSearchResult: (index: number) => void
  goToNextResult: () => void
  goToPreviousResult: () => void
  selectedItem: ExtractedPdfTextItem | null
  selectItemById: (itemId: string, pageIndex: number) => void
  clearSelection: () => void
  adjustmentBounds: PageRect | null
  setAdjustmentBounds: (bounds: PageRect | null) => void
  refreshCurrentPage: () => void
}

const PdfTextInspectContext = createContext<PdfTextInspectContextValue | null>(null)

interface PdfTextInspectProviderProps {
  activePageIndex: number
  pageCount: number
  onNavigateToPage: (pageNumber: number) => void
  children: ReactNode
}

export function PdfTextInspectProvider({
  activePageIndex,
  pageCount,
  onNavigateToPage,
  children,
}: PdfTextInspectProviderProps) {
  const { pdf, status, renderGeneration } = usePdfViewer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheVersion, setCacheVersion] = useState(0)
  const [pageReloadNonce, setPageReloadNonce] = useState(0)
  const pageCacheRef = useRef<Record<number, ExtractedPdfTextItem[]>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<'page' | 'document'>('page')
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [adjustmentBounds, setAdjustmentBounds] = useState<PageRect | null>(
    null,
  )

  const resetCache = useCallback(() => {
    pageCacheRef.current = {}
    setCacheVersion((value) => value + 1)
  }, [])

  const loadPage = useCallback(
    async (pageIndex: number): Promise<ExtractedPdfTextItem[]> => {
      if (!pdf || status !== 'ready') {
        return []
      }
      const cached = pageCacheRef.current[pageIndex]
      if (cached) {
        return cached
      }
      const items = await extractPageTextItems(pdf, pageIndex)
      pageCacheRef.current[pageIndex] = items
      setCacheVersion((value) => value + 1)
      return items
    },
    [pdf, status],
  )

  const refreshCurrentPage = useCallback(() => {
    delete pageCacheRef.current[activePageIndex]
    setPageReloadNonce((value) => value + 1)
  }, [activePageIndex])

  useEffect(() => {
    resetCache()
    setSelectedItemId(null)
    setAdjustmentBounds(null)
    setSearchQuery('')
    setActiveResultIndex(0)
  }, [renderGeneration, resetCache])

  useEffect(() => {
    if (!pdf || status !== 'ready') {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadPage(activePageIndex)
      .catch(() => {
        if (!cancelled) {
          setError('Could not extract text from this page.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pdf, status, activePageIndex, loadPage, pageReloadNonce])

  useEffect(() => {
    if (searchScope !== 'document' || !pdf || status !== 'ready' || !searchQuery.trim()) {
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        for (let index = 0; index < pageCount; index += 1) {
          if (cancelled) {
            return
          }
          await loadPage(index)
        }
      } catch {
        if (!cancelled) {
          setError('Could not extract text from every page.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchScope, pdf, status, pageCount, loadPage, searchQuery])

  const pageItems = pageCacheRef.current[activePageIndex] ?? []
  const allItems = useMemo(() => {
    void cacheVersion
    return Object.keys(pageCacheRef.current)
      .map((key) => Number(key))
      .sort((a, b) => a - b)
      .flatMap((index) => pageCacheRef.current[index] ?? [])
  }, [cacheVersion, activePageIndex])

  const searchableItems = searchScope === 'document' ? allItems : pageItems

  const searchResults = useMemo(
    () => searchExtractedTextItems(searchableItems, searchQuery),
    [searchableItems, searchQuery],
  )

  useEffect(() => {
    if (activeResultIndex >= searchResults.length) {
      setActiveResultIndex(0)
    }
  }, [searchResults.length, activeResultIndex])

  const focusSearchResult = useCallback(
    (index: number) => {
      const result = searchResults[index]
      if (!result) {
        return
      }
      setActiveResultIndex(index)
      onNavigateToPage(result.pageIndex + 1)
      setSelectedItemId(result.itemId)
      setAdjustmentBounds(result.matchBounds)
    },
    [searchResults, onNavigateToPage],
  )

  const activeSearchResult =
    searchResults.length > 0 ? (searchResults[activeResultIndex] ?? null) : null

  const goToNextResult = useCallback(() => {
    if (searchResults.length === 0) {
      return
    }
    focusSearchResult((activeResultIndex + 1) % searchResults.length)
  }, [searchResults.length, activeResultIndex, focusSearchResult])

  const goToPreviousResult = useCallback(() => {
    if (searchResults.length === 0) {
      return
    }
    focusSearchResult(
      (activeResultIndex - 1 + searchResults.length) % searchResults.length,
    )
  }, [searchResults.length, activeResultIndex, focusSearchResult])

  const selectedItem = useMemo(() => {
    if (!selectedItemId) {
      return null
    }
    for (const items of Object.values(pageCacheRef.current)) {
      const found = items.find((item) => item.id === selectedItemId)
      if (found) {
        return found
      }
    }
    return null
  }, [selectedItemId, cacheVersion])

  const selectItemById = useCallback(
    (itemId: string, pageIndex: number) => {
      onNavigateToPage(pageIndex + 1)
      setSelectedItemId(itemId)
      const item = pageCacheRef.current[pageIndex]?.find(
        (entry) => entry.id === itemId,
      )
      setAdjustmentBounds(item?.bounds ?? null)
    },
    [onNavigateToPage],
  )

  const value = useMemo<PdfTextInspectContextValue>(
    () => ({
      loading,
      error,
      pageItems,
      allItems,
      searchQuery,
      setSearchQuery,
      searchScope,
      setSearchScope,
      searchResults,
      activeResultIndex,
      activeSearchResult,
      focusSearchResult,
      goToNextResult,
      goToPreviousResult,
      selectedItem,
      selectItemById,
      clearSelection: () => {
        setSelectedItemId(null)
        setAdjustmentBounds(null)
      },
      adjustmentBounds,
      setAdjustmentBounds,
      refreshCurrentPage,
    }),
    [
      loading,
      error,
      pageItems,
      allItems,
      searchQuery,
      searchScope,
      searchResults,
      activeResultIndex,
      activeSearchResult,
      focusSearchResult,
      goToNextResult,
      goToPreviousResult,
      selectedItem,
      selectItemById,
      adjustmentBounds,
      refreshCurrentPage,
    ],
  )

  return (
    <PdfTextInspectContext.Provider value={value}>
      {children}
    </PdfTextInspectContext.Provider>
  )
}

export function usePdfTextInspect(): PdfTextInspectContextValue {
  const context = useContext(PdfTextInspectContext)
  if (!context) {
    throw new Error('usePdfTextInspect must be used within PdfTextInspectProvider')
  }
  return context
}
