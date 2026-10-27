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
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { releaseOcrWorker } from '@/lib/ocr/ocrWorkerPool'
import { OcrCancelledError, runPageOcr } from '@/lib/ocr/runPageOcr'
import {
  MIN_SELECTABLE_TEXT_CHARS,
  analyzePageText,
  ocrItemsToRuns,
  readPageGeometry,
  runsInsideRegion,
  type PageTextAnalysis,
} from '@/lib/sections/analyzePageText'
import { buildManualSection } from '@/lib/sections/buildManualSection'
import {
  compareSectionsInReadingOrder,
  detectPageSections,
} from '@/lib/sections/detectPageSections'
import { manualSectionId } from '@/lib/sections/sectionIds'
import type { PageRect } from '@/types'
import type {
  DocumentSection,
  PageSectionAnalysis,
  SectionTextRun,
} from '@/types/documentSections'

export interface SectionJob {
  readonly kind: 'text' | 'ocr' | 'region_ocr'
  readonly message: string
  /** 0–1 across all pages in the job. */
  readonly progress: number
}

interface DocumentSectionsContextValue {
  sections: readonly DocumentSection[]
  analyses: Readonly<Record<number, PageSectionAnalysis>>
  job: SectionJob | null
  error: string | null
  clearError: () => void
  /** Pages analyzed with almost no selectable text and OCR not yet completed. */
  pagesNeedingOcr: readonly number[]
  detectPages: (pageIndices: readonly number[]) => void
  runOcrOnPages: (pageIndices: readonly number[]) => void
  readSectionWithOcr: (sectionId: string) => void
  cancelJob: () => void
  labelFor: (section: DocumentSection) => string
  renameSection: (sectionId: string, label: string) => void
  selectedIds: ReadonlySet<string>
  toggleSelected: (sectionId: string) => void
  setSelectedIds: (sectionIds: readonly string[]) => void
  clearSelection: () => void
  activeSectionId: string | null
  focusSection: (sectionId: string) => void
  goToPage: (pageIndex: number) => void
  clearActive: () => void
  /** Bumps whenever a section is focused, so the canvas can scroll it into view. */
  focusNonce: number
  manualSelectActive: boolean
  setManualSelectActive: (active: boolean) => void
  addManualSection: (pageIndex: number, pdfBounds: PageRect) => void
  removeSection: (sectionId: string) => void
  clearAllSections: () => void
  outlinesVisible: boolean
  setOutlinesVisible: (visible: boolean) => void
}

const DocumentSectionsContext = createContext<DocumentSectionsContextValue | null>(null)

interface DocumentSectionsProviderProps {
  onNavigateToPage: (pageNumber: number) => void
  children: ReactNode
}

function friendlyError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? `${fallback} (${cause.message})` : fallback
}

function sortSections(list: DocumentSection[]): DocumentSection[] {
  return list.sort(compareSectionsInReadingOrder)
}

export function DocumentSectionsProvider({
  onNavigateToPage,
  children,
}: DocumentSectionsProviderProps) {
  const { pdf, status, renderGeneration } = usePdfViewer()
  const { languageId, job: ocrTabJob } = useOcrSession()

  const [sections, setSections] = useState<DocumentSection[]>([])
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({})
  const [analyses, setAnalyses] = useState<Record<number, PageSectionAnalysis>>({})
  const [selectedIdList, setSelectedIdList] = useState<string[]>([])
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const [job, setJob] = useState<SectionJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manualSelectActive, setManualSelectActive] = useState(false)
  const [outlinesVisible, setOutlinesVisible] = useState(true)

  const textCacheRef = useRef(new Map<number, PageTextAnalysis>())
  const ocrRunsRef = useRef(new Map<number, SectionTextRun[]>())
  const generationRef = useRef(0)
  const ocrActiveRef = useRef(false)
  const manualCounterRef = useRef(0)
  const jobRef = useRef<SectionJob | null>(null)
  const updateJob = useCallback((next: SectionJob | null) => {
    jobRef.current = next
    setJob(next)
  }, [])

  const ocrTabBusy =
    ocrTabJob.status === 'rendering' ||
    ocrTabJob.status === 'loading-worker' ||
    ocrTabJob.status === 'recognizing'

  const stopActiveWork = useCallback(() => {
    generationRef.current += 1
    if (ocrActiveRef.current) {
      ocrActiveRef.current = false
      void releaseOcrWorker()
    }
  }, [])

  useEffect(() => {
    stopActiveWork()
    textCacheRef.current.clear()
    ocrRunsRef.current.clear()
    manualCounterRef.current = 0
    setSections([])
    setLabelOverrides({})
    setAnalyses({})
    setSelectedIdList([])
    setActiveSectionId(null)
    updateJob(null)
    setError(null)
    setManualSelectActive(false)
  }, [renderGeneration, stopActiveWork, updateJob])

  useEffect(() => stopActiveWork, [stopActiveWork])

  const getTextAnalysis = useCallback(
    async (pageIndex: number, fresh = false): Promise<PageTextAnalysis> => {
      if (!pdf) {
        throw new Error('PDF is not loaded.')
      }
      const cached = textCacheRef.current.get(pageIndex)
      if (cached && !fresh) {
        return cached
      }
      const analysis = await analyzePageText(pdf, pageIndex)
      textCacheRef.current.set(pageIndex, analysis)
      return analysis
    },
    [pdf],
  )

  const replacePageSections = useCallback(
    (
      pageIndex: number,
      shouldReplace: (section: DocumentSection) => boolean,
      next: readonly DocumentSection[],
    ) => {
      setSections((prev) =>
        sortSections([
          ...prev.filter(
            (section) => !(section.pageIndex === pageIndex && shouldReplace(section)),
          ),
          ...next,
        ]),
      )
    },
    [],
  )

  const patchAnalysis = useCallback(
    (pageIndex: number, patch: Partial<PageSectionAnalysis>) => {
      setAnalyses((prev) => {
        const base: PageSectionAnalysis = prev[pageIndex] ?? {
          pageIndex,
          status: 'analyzing',
          rotation: 0,
          textRunCount: 0,
          textCharCount: 0,
          hasImages: null,
          ocr: 'not_run',
          ocrWordCount: 0,
          error: null,
        }
        return { ...prev, [pageIndex]: { ...base, ...patch } }
      })
    },
    [],
  )

  const canStart = useCallback((): boolean => {
    if (!pdf || status !== 'ready') {
      setError('Open a PDF before detecting sections.')
      return false
    }
    if (jobRef.current) {
      return false
    }
    return true
  }, [pdf, status])

  const detectPages = useCallback(
    (pageIndices: readonly number[]) => {
      if (!canStart() || pageIndices.length === 0) {
        return
      }
      const generation = ++generationRef.current
      setError(null)
      setManualSelectActive(false)
      void (async () => {
        for (const [position, pageIndex] of pageIndices.entries()) {
          if (generationRef.current !== generation) {
            return
          }
          updateJob({
            kind: 'text',
            message: `Reading selectable text on page ${pageIndex + 1}…`,
            progress: position / pageIndices.length,
          })
          patchAnalysis(pageIndex, { status: 'analyzing', error: null })
          try {
            const analysis = await getTextAnalysis(pageIndex, true)
            if (generationRef.current !== generation) {
              return
            }
            const detected = detectPageSections({ ...analysis, textSource: 'pdf_text' })
            replacePageSections(
              pageIndex,
              (section) => section.origin === 'auto' && section.textSource === 'pdf_text',
              detected,
            )
            patchAnalysis(pageIndex, {
              status: 'done',
              rotation: analysis.rotation,
              textRunCount: analysis.runs.length,
              textCharCount: analysis.textCharCount,
              hasImages: analysis.hasImages,
            })
          } catch (cause) {
            if (generationRef.current !== generation) {
              return
            }
            patchAnalysis(pageIndex, {
              status: 'error',
              error: friendlyError(
                cause,
                'Could not read text on this page. The file may be damaged or use an unsupported font encoding. Try OCR or draw a region manually.',
              ),
            })
          }
        }
        if (generationRef.current === generation) {
          updateJob(null)
        }
      })()
    },
    [canStart, getTextAnalysis, patchAnalysis, replacePageSections, updateJob],
  )

  const runOcrOnPages = useCallback(
    (pageIndices: readonly number[]) => {
      if (!canStart() || pageIndices.length === 0 || !pdf) {
        return
      }
      if (ocrTabBusy) {
        setError('The OCR tab is already running. Wait for it to finish or cancel it first.')
        return
      }
      const generation = ++generationRef.current
      const isCancelled = () => generationRef.current !== generation
      setError(null)
      setManualSelectActive(false)
      ocrActiveRef.current = true
      void (async () => {
        for (const [position, pageIndex] of pageIndices.entries()) {
          if (isCancelled()) {
            return
          }
          const label = `OCR page ${pageIndex + 1}`
          const update = (message: string, pageProgress: number) =>
            updateJob({
              kind: 'ocr',
              message: `${label}: ${message}`,
              progress: (position + pageProgress) / pageIndices.length,
            })
          update('preparing…', 0)
          patchAnalysis(pageIndex, { ocr: 'running' })
          try {
            const text = await getTextAnalysis(pageIndex)
            patchAnalysis(pageIndex, {
              status: 'done',
              rotation: text.rotation,
              textRunCount: text.runs.length,
              textCharCount: text.textCharCount,
              hasImages: text.hasImages,
            })
            const result = await runPageOcr({
              pdf,
              pageIndex,
              languageId,
              isCancelled,
              onPhase: (_phase, message) => {
                if (!isCancelled()) {
                  update(message, 0)
                }
              },
              onProgress: (progress, statusText) => {
                if (!isCancelled()) {
                  update(statusText, Math.min(Math.max(progress, 0), 1))
                }
              },
            })
            if (isCancelled()) {
              return
            }
            const runs = ocrItemsToRuns(result.items, text.runs)
            ocrRunsRef.current.set(pageIndex, runs)
            const detected = detectPageSections({ ...text, runs, textSource: 'ocr' })
            replacePageSections(
              pageIndex,
              (section) => section.origin === 'auto' && section.textSource === 'ocr',
              detected,
            )
            patchAnalysis(pageIndex, { ocr: 'done', ocrWordCount: runs.length })
          } catch (cause) {
            if (cause instanceof OcrCancelledError || isCancelled()) {
              patchAnalysis(pageIndex, { ocr: 'cancelled' })
              return
            }
            patchAnalysis(pageIndex, { ocr: 'error' })
            setError(
              friendlyError(
                cause,
                `OCR failed on page ${pageIndex + 1}. The first run downloads language data, so check your connection and try again.`,
              ),
            )
          }
        }
        if (!isCancelled()) {
          ocrActiveRef.current = false
          updateJob(null)
        }
      })()
    },
    [
      canStart,
      pdf,
      ocrTabBusy,
      languageId,
      getTextAnalysis,
      patchAnalysis,
      replacePageSections,
      updateJob,
    ],
  )

  const cancelJob = useCallback(() => {
    stopActiveWork()
    updateJob(null)
    setAnalyses((prev) => {
      const next: Record<number, PageSectionAnalysis> = {}
      for (const [key, analysis] of Object.entries(prev)) {
        if (analysis.status === 'analyzing') {
          continue
        }
        next[Number(key)] =
          analysis.ocr === 'running' ? { ...analysis, ocr: 'cancelled' } : analysis
      }
      return next
    })
  }, [stopActiveWork, updateJob])

  const addManualSection = useCallback(
    (pageIndex: number, pdfBounds: PageRect) => {
      if (!pdf) {
        return
      }
      setManualSelectActive(false)
      void (async () => {
        let runs: SectionTextRun[] = []
        let textSource: DocumentSection['textSource'] = 'none'
        let toDisplayRect: (rect: PageRect) => PageRect
        try {
          const analysis = await getTextAnalysis(pageIndex)
          toDisplayRect = analysis.toDisplayRect
          const pdfRuns = runsInsideRegion(analysis.runs, pdfBounds)
          const ocrRuns = runsInsideRegion(ocrRunsRef.current.get(pageIndex) ?? [], pdfBounds)
          if (pdfRuns.length > 0) {
            runs = pdfRuns
            textSource = 'pdf_text'
          } else if (ocrRuns.length > 0) {
            runs = ocrRuns
            textSource = 'ocr'
          }
        } catch {
          toDisplayRect = (await readPageGeometry(pdf, pageIndex)).toDisplayRect
        }
        manualCounterRef.current += 1
        const section = buildManualSection({
          id: manualSectionId(),
          pageIndex,
          bounds: pdfBounds,
          runs,
          textSource,
          toDisplayRect,
          ordinal: manualCounterRef.current,
        })
        setSections((prev) => sortSections([...prev, section]))
        setSelectedIdList((prev) => [...prev, section.id])
        setActiveSectionId(section.id)
        setFocusNonce((value) => value + 1)
      })()
    },
    [pdf, getTextAnalysis],
  )

  const readSectionWithOcr = useCallback(
    (sectionId: string) => {
      const section = sections.find((entry) => entry.id === sectionId)
      if (!section || !pdf || !canStart()) {
        return
      }
      if (ocrTabBusy) {
        setError('The OCR tab is already running. Wait for it to finish or cancel it first.')
        return
      }
      const generation = ++generationRef.current
      const isCancelled = () => generationRef.current !== generation
      ocrActiveRef.current = true
      setError(null)
      updateJob({ kind: 'region_ocr', message: 'Reading region with OCR…', progress: 0 })
      void (async () => {
        try {
          const geometry = await readPageGeometry(pdf, section.pageIndex)
          const result = await runPageOcr({
            pdf,
            pageIndex: section.pageIndex,
            languageId,
            regionBounds: section.bounds,
            isCancelled,
            onProgress: (progress, statusText) => {
              if (!isCancelled()) {
                updateJob({ kind: 'region_ocr', message: statusText, progress })
              }
            },
          })
          if (isCancelled()) {
            return
          }
          const runs = ocrItemsToRuns(result.items, [])
          const ordinal = Number(/Region (\d+)/.exec(section.suggestedLabel)?.[1] ?? 0)
          const rebuilt = buildManualSection({
            id: section.id,
            pageIndex: section.pageIndex,
            bounds: section.bounds,
            runs,
            textSource: 'ocr',
            toDisplayRect: geometry.toDisplayRect,
            ordinal,
          })
          setSections((prev) =>
            sortSections(prev.map((entry) => (entry.id === section.id ? rebuilt : entry))),
          )
          if (runs.length === 0) {
            setError('OCR found no readable text in this region.')
          }
        } catch (cause) {
          if (!(cause instanceof OcrCancelledError) && !isCancelled()) {
            setError(friendlyError(cause, 'OCR failed for this region. Check your connection and try again.'))
          }
        } finally {
          if (!isCancelled()) {
            ocrActiveRef.current = false
            updateJob(null)
          }
        }
      })()
    },
    [sections, pdf, canStart, ocrTabBusy, languageId, updateJob],
  )

  const labelFor = useCallback(
    (section: DocumentSection) => labelOverrides[section.id] ?? section.suggestedLabel,
    [labelOverrides],
  )

  const renameSection = useCallback(
    (sectionId: string, label: string) => {
      const trimmed = label.trim()
      const section = sections.find((entry) => entry.id === sectionId)
      setLabelOverrides((prev) => {
        const next = { ...prev }
        if (!trimmed || trimmed === section?.suggestedLabel) {
          delete next[sectionId]
        } else {
          next[sectionId] = trimmed
        }
        return next
      })
    },
    [sections],
  )

  const existingIds = useMemo(() => new Set(sections.map((section) => section.id)), [sections])

  const selectedIds = useMemo(
    () => new Set(selectedIdList.filter((id) => existingIds.has(id))),
    [selectedIdList, existingIds],
  )

  const toggleSelected = useCallback((sectionId: string) => {
    setSelectedIdList((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId],
    )
  }, [])

  const setSelectedIds = useCallback((sectionIds: readonly string[]) => {
    setSelectedIdList([...new Set(sectionIds)])
  }, [])

  const clearSelection = useCallback(() => setSelectedIdList([]), [])

  const focusSection = useCallback(
    (sectionId: string) => {
      const section = sections.find((entry) => entry.id === sectionId)
      if (!section) {
        return
      }
      onNavigateToPage(section.pageIndex + 1)
      setActiveSectionId(sectionId)
      setFocusNonce((value) => value + 1)
    },
    [sections, onNavigateToPage],
  )

  const removeSection = useCallback((sectionId: string) => {
    setSections((prev) => prev.filter((section) => section.id !== sectionId))
    setSelectedIdList((prev) => prev.filter((id) => id !== sectionId))
    setActiveSectionId((prev) => (prev === sectionId ? null : prev))
    setLabelOverrides((prev) => {
      if (!(sectionId in prev)) {
        return prev
      }
      const next = { ...prev }
      delete next[sectionId]
      return next
    })
  }, [])

  const clearAllSections = useCallback(() => {
    stopActiveWork()
    ocrRunsRef.current.clear()
    manualCounterRef.current = 0
    updateJob(null)
    setSections([])
    setLabelOverrides({})
    setAnalyses({})
    setSelectedIdList([])
    setActiveSectionId(null)
    setManualSelectActive(false)
    setError(null)
  }, [stopActiveWork, updateJob])

  const pagesNeedingOcr = useMemo(
    () =>
      Object.values(analyses)
        .filter(
          (analysis) =>
            analysis.status === 'done' &&
            analysis.textCharCount < MIN_SELECTABLE_TEXT_CHARS &&
            analysis.ocr !== 'done',
        )
        .map((analysis) => analysis.pageIndex)
        .sort((a, b) => a - b),
    [analyses],
  )

  const activeExists = activeSectionId !== null && existingIds.has(activeSectionId)

  const value = useMemo<DocumentSectionsContextValue>(
    () => ({
      sections,
      analyses,
      job,
      error,
      clearError: () => setError(null),
      pagesNeedingOcr,
      detectPages,
      runOcrOnPages,
      readSectionWithOcr,
      cancelJob,
      labelFor,
      renameSection,
      selectedIds,
      toggleSelected,
      setSelectedIds,
      clearSelection,
      activeSectionId: activeExists ? activeSectionId : null,
      focusSection,
      goToPage: (pageIndex: number) => onNavigateToPage(pageIndex + 1),
      clearActive: () => setActiveSectionId(null),
      focusNonce,
      manualSelectActive,
      setManualSelectActive,
      addManualSection,
      removeSection,
      clearAllSections,
      outlinesVisible,
      setOutlinesVisible,
    }),
    [
      sections,
      analyses,
      job,
      error,
      pagesNeedingOcr,
      detectPages,
      runOcrOnPages,
      readSectionWithOcr,
      cancelJob,
      labelFor,
      renameSection,
      selectedIds,
      toggleSelected,
      setSelectedIds,
      clearSelection,
      activeExists,
      activeSectionId,
      focusSection,
      onNavigateToPage,
      focusNonce,
      manualSelectActive,
      addManualSection,
      removeSection,
      clearAllSections,
      outlinesVisible,
    ],
  )

  return (
    <DocumentSectionsContext.Provider value={value}>
      {children}
    </DocumentSectionsContext.Provider>
  )
}

export function useDocumentSections(): DocumentSectionsContextValue {
  const context = useContext(DocumentSectionsContext)
  if (!context) {
    throw new Error('useDocumentSections must be used within DocumentSectionsProvider')
  }
  return context
}
