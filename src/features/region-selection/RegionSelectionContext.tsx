import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { normalizePageRotation, type QuarterTurn } from '@/lib/pdf/export/rotationFrame'
import { pageBoxFromView, type PageBox } from '@/lib/regionSelection/regionGeometry'
import {
  INITIAL_REGION_SELECTION,
  regionSelectionReducer,
  type RegionSelection,
} from '@/lib/regionSelection/selectionState'
import type { PageRect } from '@/types'

export type RegionAction = 'analyze' | 'annotate' | 'cover' | 'redact'

export interface RegionPageGeometry {
  readonly pageIndex: number
  readonly box: PageBox
  readonly rotation: QuarterTurn
}

interface RegionSelectionContextValue {
  /** 0-based page the editor is showing. */
  currentPageIndex: number
  selection: RegionSelection | null
  /** Page box and rotation of the selected page (null until loaded). */
  geometry: RegionPageGeometry | null
  canUndoSelection: boolean
  drawSelection: (selection: RegionSelection) => void
  adjustSelection: (bounds: PageRect) => void
  undoSelection: () => void
  cancelSelection: () => void
  activeAction: RegionAction | null
  openAction: (action: RegionAction) => void
  closeAction: () => void
}

const RegionSelectionContext = createContext<RegionSelectionContextValue | null>(null)

/**
 * Holds the rectangle the user is working with. It is deliberately separate from the
 * editor session: nothing here is an edit, enters undo history, is saved or exported.
 */
export function RegionSelectionProvider({
  currentPageIndex,
  children,
}: {
  currentPageIndex: number
  children: ReactNode
}) {
  const { activeToolId } = useEditorSession()
  const { pdf, renderGeneration } = usePdfViewer()
  const [state, dispatch] = useReducer(regionSelectionReducer, INITIAL_REGION_SELECTION)
  const [geometry, setGeometry] = useState<RegionPageGeometry | null>(null)
  const [activeAction, setActiveAction] = useState<RegionAction | null>(null)

  const cancelSelection = useCallback(() => {
    dispatch({ type: 'cancel' })
    setActiveAction(null)
  }, [])

  useEffect(() => {
    if (activeToolId !== 'region') {
      cancelSelection()
    }
  }, [activeToolId, cancelSelection])

  useEffect(() => {
    cancelSelection()
  }, [renderGeneration, cancelSelection])

  const selectedPage = state.selection?.pageIndex ?? null
  useEffect(() => {
    if (!pdf || selectedPage === null) {
      return
    }
    let cancelled = false
    void pdf.getPage(selectedPage + 1).then((page) => {
      if (!cancelled) {
        setGeometry({
          pageIndex: selectedPage,
          box: pageBoxFromView(page.view),
          rotation: normalizePageRotation(page.rotate),
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [pdf, selectedPage])

  const drawSelection = useCallback((selection: RegionSelection) => {
    dispatch({ type: 'draw', selection })
  }, [])
  const adjustSelection = useCallback((bounds: PageRect) => {
    dispatch({ type: 'adjust', bounds })
  }, [])
  const undoSelection = useCallback(() => dispatch({ type: 'undo' }), [])
  const openAction = useCallback((action: RegionAction) => setActiveAction(action), [])
  const closeAction = useCallback(() => setActiveAction(null), [])

  const value = useMemo<RegionSelectionContextValue>(
    () => ({
      currentPageIndex,
      selection: state.selection,
      geometry: geometry && geometry.pageIndex === selectedPage ? geometry : null,
      canUndoSelection: state.past.length > 0,
      drawSelection,
      adjustSelection,
      undoSelection,
      cancelSelection,
      activeAction,
      openAction,
      closeAction,
    }),
    [
      currentPageIndex,
      state,
      geometry,
      selectedPage,
      drawSelection,
      adjustSelection,
      undoSelection,
      cancelSelection,
      activeAction,
      openAction,
      closeAction,
    ],
  )

  return <RegionSelectionContext.Provider value={value}>{children}</RegionSelectionContext.Provider>
}

export function useRegionSelection(): RegionSelectionContextValue {
  const context = useContext(RegionSelectionContext)
  if (!context) {
    throw new Error('useRegionSelection must be used within RegionSelectionProvider')
  }
  return context
}