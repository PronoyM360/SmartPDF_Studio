import { OPS } from 'pdfjs-dist'
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
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import {
  committedAmountEdits,
  type CommittedAmountEdit,
  type OverlayTextCorrectionInput,
} from '@/features/pdf-editor/textCorrectionOverlays'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { releaseOcrWorker } from '@/lib/ocr/ocrWorkerPool'
import { OcrCancelledError, runPageOcr } from '@/lib/ocr/runPageOcr'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { isFontFaceLoaded } from '@/lib/pdf/export/overlayFontResolution'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import { parseAmount } from '@/lib/prices/amountFormat'
import { estimateBaselineY } from '@/lib/prices/buildPriceReplacementPlan'
import {
  annotateDuplicates,
  comparePriceCandidates,
  detectPriceCandidates,
  type RunTextMeasurer,
} from '@/lib/prices/detectPriceCandidates'
import {
  assignPaintColors,
  collectTextPaintRuns,
  readPdfFontInfo,
  type PdfFontInfo,
} from '@/lib/prices/pdfTextStyles'
import {
  checkEditedRelationships,
  findPriceRelationships,
  type PriceRelationship,
  type PriceRelationshipWarning,
} from '@/lib/prices/priceRelationships'
import { ocrItemsToPriceRuns, pdfItemsToPriceRuns } from '@/lib/prices/priceTextRuns'
import { IMAGE_OPS } from '@/lib/sections/analyzePageText'
import type { PriceCandidate, PriceTextRun, RejectedPriceToken } from '@/types/priceEditing'
import { canvasTextMetrics } from './canvasTextMetrics'
import type { PriceStyleEvidence } from './resolvePriceStyle'

export interface PageScan {
  readonly status: 'scanning' | 'done' | 'error'
  readonly runs: readonly PriceTextRun[]
  readonly candidates: readonly PriceCandidate[]
  /** Numbers that were deliberately not treated as prices, with the reason. */
  readonly rejected: readonly RejectedPriceToken[]
  readonly fonts: Readonly<Record<string, PdfFontInfo>>
  readonly contentColors: ReadonlyMap<string, string | null>
  readonly hasImages: boolean | null
  readonly textCharCount: number
  readonly error: string | null
}

export interface OcrPriceScan {
  readonly status: 'running' | 'done' | 'error' | 'cancelled'
  readonly runs: readonly PriceTextRun[]
  readonly candidates: readonly PriceCandidate[]
  readonly message: string
  readonly progress: number
  readonly error: string | null
}

export interface AmountEditRequest {
  readonly candidate: PriceCandidate
  /** Original text as confirmed by the user (OCR readings may be corrected). */
  readonly originalText: string
  readonly replacementText: string
  readonly replacementValue: number | null
  readonly plan: TextReplacementPlan
  readonly evidence: PriceStyleEvidence
}

interface PriceEditorContextValue {
  scans: Readonly<Record<number, PageScan>>
  ocrScans: Readonly<Record<number, OcrPriceScan>>
  candidates: readonly PriceCandidate[]
  relationships: readonly PriceRelationship[]
  committedEdits: ReadonlyMap<string, CommittedAmountEdit>
  committedValues: ReadonlyMap<string, number>
  committedWarnings: readonly PriceRelationshipWarning[]
  scanning: boolean
  scanPages: (pageIndices: readonly number[]) => void
  ocrBusy: boolean
  runOcrForPrices: (pageIndex: number) => void
  cancelOcrForPrices: () => void
  selectedId: string | null
  selectCandidate: (candidateId: string | null) => void
  focusNonce: number
  editingId: string | null
  openEditor: (candidateId: string) => void
  closeEditor: () => void
  highlightsVisible: boolean
  setHighlightsVisible: (visible: boolean) => void
  panelActive: boolean
  setPanelActive: (active: boolean) => void
  getRun: (candidate: PriceCandidate) => PriceTextRun | null
  getFont: (candidate: PriceCandidate) => PdfFontInfo | null
  getContentColor: (candidate: PriceCandidate) => string | null
  /** Other text on the page that a replacement must not cover. */
  getNeighborRuns: (candidate: PriceCandidate) => readonly PriceTextRun[]
  /** The measurer detection used on this page, so sub-run spans line up with candidates. */
  getRunMeasurer: (pageIndex: number) => RunTextMeasurer
  applyAmountEdits: (requests: readonly AmountEditRequest[]) => void
  revertEdit: (targetKey: string) => void
}

const PriceEditorContext = createContext<PriceEditorContextValue | null>(null)

const DEFAULT_FAMILY: Record<PdfFontInfo['genericFamily'], string> = {
  'sans-serif': 'Arial',
  serif: 'Times New Roman',
  monospace: 'Courier New',
}

function measurerFor(fonts: Readonly<Record<string, PdfFontInfo>>): RunTextMeasurer {
  return (text, run) => {
    const font = fonts[run.fontName]
    const family =
      font?.embedded && font.loadedName && isFontFaceLoaded(font.loadedName)
        ? font.loadedName
        : DEFAULT_FAMILY[font?.genericFamily ?? 'sans-serif']
    const weight = font?.embedded ? 'normal' : font?.bold ? 'bold' : 'normal'
    return canvasTextMetrics.measureWidth(text, family, weight, run.fontSizePt, 0)
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? `${fallback} (${cause.message})` : fallback
}

interface PriceEditorProviderProps {
  onNavigateToPage: (pageNumber: number) => void
  children: ReactNode
}

export function PriceEditorProvider({ onNavigateToPage, children }: PriceEditorProviderProps) {
  const { pdf, status, renderGeneration } = usePdfViewer()
  const { languageId, job: ocrTabJob } = useOcrSession()
  const { overlayObjects, applyOverlayTextCorrections, deleteOverlayObjects } = useEditorSession()

  const [scans, setScans] = useState<Record<number, PageScan>>({})
  const [ocrScans, setOcrScans] = useState<Record<number, OcrPriceScan>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const [highlightsVisible, setHighlightsVisible] = useState(true)
  const [panelActive, setPanelActive] = useState(false)
  const generationRef = useRef(0)
  const ocrGenerationRef = useRef(0)
  const scansRef = useRef(scans)
  useEffect(() => {
    scansRef.current = scans
  }, [scans])

  useEffect(() => {
    generationRef.current += 1
    ocrGenerationRef.current += 1
    setScans({})
    setOcrScans({})
    setSelectedId(null)
    setEditingId(null)
  }, [renderGeneration])

  const scanPage = useCallback(
    async (pageIndex: number): Promise<PageScan> => {
      if (!pdf) {
        throw new Error('PDF is not loaded.')
      }
      const page = await pdf.getPage(pageIndex + 1)
      const [items, operatorList] = await Promise.all([
        extractPageTextItems(pdf, pageIndex),
        page.getOperatorList(),
      ])
      const fonts: Record<string, PdfFontInfo> = {}
      for (const fontId of new Set(items.map((item) => item.fontName))) {
        const info = readPdfFontInfo(page.commonObjs, fontId)
        if (info) {
          fonts[fontId] = info
        }
      }
      const runs = pdfItemsToPriceRuns(items)
      const { candidates, rejected } = detectPriceCandidates(runs, { measure: measurerFor(fonts) })
      const contentColors = assignPaintColors(candidates, collectTextPaintRuns(operatorList, OPS))
      return {
        status: 'done',
        runs,
        candidates,
        rejected,
        fonts,
        contentColors,
        hasImages: Array.from(operatorList.fnArray).some((fn) => IMAGE_OPS.has(fn)),
        textCharCount: items.reduce((sum, item) => sum + item.text.replace(/\s/g, '').length, 0),
        error: null,
      }
    },
    [pdf],
  )

  const [scanning, setScanning] = useState(false)

  const scanPages = useCallback(
    (pageIndices: readonly number[]) => {
      if (!pdf || status !== 'ready' || pageIndices.length === 0) {
        return
      }
      const generation = ++generationRef.current
      setScanning(true)
      void (async () => {
        for (const pageIndex of pageIndices) {
          if (generationRef.current !== generation) {
            return
          }
          setScans((prev) => ({
            ...prev,
            [pageIndex]: {
              ...(prev[pageIndex] ?? {
                runs: [],
                candidates: [],
                rejected: [],
                fonts: {},
                contentColors: new Map(),
                hasImages: null,
                textCharCount: 0,
              }),
              status: 'scanning',
              error: null,
            },
          }))
          try {
            const scan = await scanPage(pageIndex)
            if (generationRef.current === generation) {
              setScans((prev) => ({ ...prev, [pageIndex]: scan }))
            }
          } catch (cause) {
            if (generationRef.current === generation) {
              setScans((prev) => ({
                ...prev,
                [pageIndex]: {
                  ...(prev[pageIndex] as PageScan),
                  status: 'error',
                  error: errorMessage(cause, 'Could not read text on this page.'),
                },
              }))
            }
          }
        }
        if (generationRef.current === generation) {
          setScanning(false)
        }
      })()
    },
    [pdf, status, scanPage],
  )

  const ocrTabBusy =
    ocrTabJob.status === 'rendering' ||
    ocrTabJob.status === 'loading-worker' ||
    ocrTabJob.status === 'recognizing'
  const ocrBusy = Object.values(ocrScans).some((scan) => scan.status === 'running')

  const runOcrForPrices = useCallback(
    (pageIndex: number) => {
      if (!pdf || status !== 'ready' || ocrBusy) {
        return
      }
      if (ocrTabBusy) {
        setOcrScans((prev) => ({
          ...prev,
          [pageIndex]: {
            status: 'error',
            runs: [],
            candidates: [],
            message: '',
            progress: 0,
            error: 'The OCR tab is already running. Wait for it to finish or cancel it first.',
          },
        }))
        return
      }
      const generation = ++ocrGenerationRef.current
      const isCancelled = () => ocrGenerationRef.current !== generation
      const update = (patch: Partial<OcrPriceScan>) =>
        setOcrScans((prev) => ({
          ...prev,
          [pageIndex]: {
            status: 'running',
            runs: [],
            candidates: [],
            message: '',
            progress: 0,
            error: null,
            ...prev[pageIndex],
            ...patch,
          },
        }))
      update({ status: 'running', message: 'Preparing page…', progress: 0, error: null })
      void (async () => {
        try {
          const textScan = scansRef.current[pageIndex]?.status === 'done' ? scansRef.current[pageIndex]! : await scanPage(pageIndex)
          if (!scansRef.current[pageIndex] || scansRef.current[pageIndex]?.status !== 'done') {
            setScans((prev) => ({ ...prev, [pageIndex]: textScan }))
          }
          const result = await runPageOcr({
            pdf,
            pageIndex,
            languageId,
            isCancelled,
            onPhase: (_phase, message) => {
              if (!isCancelled()) {
                update({ message })
              }
            },
            onProgress: (progress, message) => {
              if (!isCancelled()) {
                update({ progress, message })
              }
            },
          })
          if (isCancelled()) {
            return
          }
          const runs = ocrItemsToPriceRuns(result.items, textScan.runs)
          const { candidates } = detectPriceCandidates(runs)
          update({
            status: 'done',
            runs,
            candidates,
            progress: 1,
            message: `OCR read ${runs.length} word${runs.length === 1 ? '' : 's'} inside images.`,
          })
        } catch (cause) {
          if (cause instanceof OcrCancelledError || isCancelled()) {
            update({ status: 'cancelled', message: 'OCR cancelled.' })
            return
          }
          update({
            status: 'error',
            error: errorMessage(cause, 'OCR failed. The first run downloads language data, so check your connection.'),
          })
        }
      })()
    },
    [pdf, status, ocrBusy, ocrTabBusy, scanPage, languageId],
  )

  const cancelOcrForPrices = useCallback(() => {
    ocrGenerationRef.current += 1
    setOcrScans((prev) => {
      const next: Record<number, OcrPriceScan> = {}
      for (const [key, scan] of Object.entries(prev)) {
        next[Number(key)] = scan.status === 'running' ? { ...scan, status: 'cancelled', message: 'OCR cancelled.' } : scan
      }
      return next
    })
    void releaseOcrWorker()
  }, [])

  const candidates = useMemo(() => {
    const all = [
      ...Object.values(scans).flatMap((scan) => scan.candidates),
      ...Object.values(ocrScans).flatMap((scan) => scan.candidates),
    ]
    return annotateDuplicates(all).sort(comparePriceCandidates)
  }, [scans, ocrScans])

  const relationships = useMemo(() => findPriceRelationships(candidates), [candidates])

  const committedEdits = useMemo(() => committedAmountEdits(overlayObjects), [overlayObjects])

  const committedValues = useMemo(() => {
    const values = new Map<string, number>()
    for (const [key, edit] of committedEdits) {
      const shown = parseAmount(edit.content)?.value ?? edit.amendment.replacementValue
      if (shown !== null && shown !== undefined) {
        values.set(key, shown)
      }
    }
    return values
  }, [committedEdits])

  const committedWarnings = useMemo(
    () => checkEditedRelationships({ candidates, relationships, editedValues: committedValues }),
    [candidates, relationships, committedValues],
  )

  const selectCandidate = useCallback(
    (candidateId: string | null) => {
      setSelectedId(candidateId)
      const candidate = candidateId ? candidates.find((entry) => entry.id === candidateId) : null
      if (candidate) {
        onNavigateToPage(candidate.pageIndex + 1)
        setFocusNonce((value) => value + 1)
      }
    },
    [candidates, onNavigateToPage],
  )

  const openEditor = useCallback(
    (candidateId: string) => {
      selectCandidate(candidateId)
      setEditingId(candidateId)
    },
    [selectCandidate],
  )

  const runsById = useMemo(() => {
    const map = new Map<string, PriceTextRun>()
    for (const scan of [...Object.values(scans), ...Object.values(ocrScans)]) {
      for (const run of scan.runs) {
        map.set(run.id, run)
      }
    }
    return map
  }, [scans, ocrScans])

  const getRun = useCallback((candidate: PriceCandidate) => runsById.get(candidate.runId) ?? null, [runsById])

  const getFont = useCallback(
    (candidate: PriceCandidate) =>
      candidate.source === 'ocr' ? null : (scans[candidate.pageIndex]?.fonts[candidate.fontName] ?? null),
    [scans],
  )

  const getContentColor = useCallback(
    (candidate: PriceCandidate) =>
      candidate.source === 'ocr' ? null : (scans[candidate.pageIndex]?.contentColors.get(candidate.id) ?? null),
    [scans],
  )

  const getNeighborRuns = useCallback(
    (candidate: PriceCandidate) => {
      const pageRuns = [
        ...(scans[candidate.pageIndex]?.runs ?? []),
        ...(ocrScans[candidate.pageIndex]?.runs ?? []),
      ]
      return pageRuns.filter((run) => run.id !== candidate.runId)
    },
    [scans, ocrScans],
  )

  const getRunMeasurer = useCallback(
    (pageIndex: number) => measurerFor(scans[pageIndex]?.fonts ?? {}),
    [scans],
  )

  const applyAmountEdits = useCallback(
    (requests: readonly AmountEditRequest[]) => {
      const inputs: OverlayTextCorrectionInput[] = requests.map((request) => {
        const { candidate, plan, evidence } = request
        const existing = committedEdits.get(candidate.id)
        const base = planToOverlayCorrectionInput({
          pageIndex: candidate.pageIndex,
          originalText: request.originalText,
          replacementText: request.replacementText,
          plan,
          editSource: candidate.source,
        })
        return {
          ...base,
          amendment: {
            kind: 'amount',
            targetKey: candidate.id,
            pageIndex: candidate.pageIndex,
            originalText: request.originalText,
            replacementText: request.replacementText.trim(),
            originalValue: parseAmount(request.originalText)?.value ?? candidate.amount.value,
            replacementValue: request.replacementValue,
            role: candidate.role,
            label: candidate.label,
            source: candidate.source,
            fontMatch: evidence.fontMatch,
            fallbackFontFamily: evidence.fallbackFontFamily,
            fallbackFontWeight: evidence.fallbackFontWeight,
            baselineY: candidate.baseline ? estimateBaselineY(candidate) : null,
          },
          replaceObjectIds: existing ? [existing.textId, existing.amendment.maskId] : [],
        }
      })
      applyOverlayTextCorrections(inputs)
    },
    [committedEdits, applyOverlayTextCorrections],
  )

  const revertEdit = useCallback(
    (targetKey: string) => {
      const edit = committedEdits.get(targetKey)
      if (edit) {
        deleteOverlayObjects([edit.textId, edit.amendment.maskId])
      }
    },
    [committedEdits, deleteOverlayObjects],
  )

  const value = useMemo<PriceEditorContextValue>(
    () => ({
      scans,
      ocrScans,
      candidates,
      relationships,
      committedEdits,
      committedValues,
      committedWarnings,
      scanning,
      scanPages,
      ocrBusy,
      runOcrForPrices,
      cancelOcrForPrices,
      selectedId,
      selectCandidate,
      focusNonce,
      editingId,
      openEditor,
      closeEditor: () => setEditingId(null),
      highlightsVisible,
      setHighlightsVisible,
      panelActive,
      setPanelActive,
      getRun,
      getFont,
      getContentColor,
      getNeighborRuns,
      getRunMeasurer,
      applyAmountEdits,
      revertEdit,
    }),
    [
      scans,
      ocrScans,
      candidates,
      relationships,
      committedEdits,
      committedValues,
      committedWarnings,
      scanning,
      scanPages,
      ocrBusy,
      runOcrForPrices,
      cancelOcrForPrices,
      selectedId,
      selectCandidate,
      focusNonce,
      editingId,
      openEditor,
      highlightsVisible,
      panelActive,
      getRun,
      getFont,
      getContentColor,
      getNeighborRuns,
      getRunMeasurer,
      applyAmountEdits,
      revertEdit,
    ],
  )

  return <PriceEditorContext.Provider value={value}>{children}</PriceEditorContext.Provider>
}

export function usePriceEditor(): PriceEditorContextValue {
  const context = useContext(PriceEditorContext)
  if (!context) {
    throw new Error('usePriceEditor must be used within PriceEditorProvider')
  }
  return context
}
