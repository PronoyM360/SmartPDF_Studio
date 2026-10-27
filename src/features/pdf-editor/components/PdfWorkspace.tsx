import { FileTextOutlined } from '@ant-design/icons'
import { Alert, Button, Spin, Typography } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type UIEventHandler,
} from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { workspaceCanvasLayerFlags } from '@/features/pdf-editor/workspaceCanvasLayerFlags'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageOverlayLayer } from '@/features/pdf-editor/PageOverlayLayer'
import { ChangeHighlightLayer } from '@/features/changes/ChangeHighlightLayer'
import { useTrackedChanges } from '@/features/changes/useTrackedChanges'
import { OcrHighlightLayer } from '@/features/ocr/OcrHighlightLayer'
import { OcrRegionSelectLayer } from '@/features/ocr/OcrRegionSelectLayer'
import { PriceHighlightLayer } from '@/features/prices/PriceHighlightLayer'
import { SectionHighlightLayer } from '@/features/sections/SectionHighlightLayer'
import { SectionRegionSelectLayer } from '@/features/sections/SectionRegionSelectLayer'
import { PendingTextReplacementPreviewLayer } from '@/features/text-tools/PendingTextReplacementPreviewLayer'
import { TextInspectHighlightLayer } from '@/features/text-tools/TextInspectHighlightLayer'
import { PdfPageCanvas } from '@/features/pdf-viewer/PdfPageCanvas'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { useContainerSize } from '@/hooks/useContainerSize'
import { computeFitScale } from '@/lib/pdf'
import type { PdfPageMeta } from '@/types'
import type { DocumentRecordSource } from '@/types/documentRecord'
import styles from './PdfWorkspace.module.css'

const { Text } = Typography

export type FitMode = 'page' | 'width'

interface PdfWorkspaceProps {
  zoomPercent: number
  fitMode: FitMode
  activePage: number
  documentSource: DocumentRecordSource
  onReplacePdf?: () => void
  onRenderScaleChange?: (scale: number) => void
}

interface PageCanvasStackProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  showCommittedOverlays: boolean
  showInspectLayers: boolean
  showPendingReplacement: boolean
  exportMatchingOnly?: boolean
}

function PageCanvasStack({
  pageNumber,
  pageIndex,
  renderScale,
  showCommittedOverlays,
  showInspectLayers,
  showPendingReplacement,
  exportMatchingOnly = false,
}: PageCanvasStackProps) {
  return (
    <div className={styles.pageStack}>
      <PdfPageCanvas pageNumber={pageNumber} scale={renderScale} />
      {showInspectLayers ? (
        <>
          <TextInspectHighlightLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
          <OcrHighlightLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
          <SectionHighlightLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
          <PriceHighlightLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
        </>
      ) : null}
      {showCommittedOverlays ? (
        <>
          <PageOverlayLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
            exportMatchingOnly={exportMatchingOnly}
          />
          <OcrRegionSelectLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
          <SectionRegionSelectLayer
            pageNumber={pageNumber}
            pageIndex={pageIndex}
            renderScale={renderScale}
          />
        </>
      ) : null}
      {showPendingReplacement ? (
        <PendingTextReplacementPreviewLayer
          pageNumber={pageNumber}
          pageIndex={pageIndex}
          renderScale={renderScale}
        />
      ) : null}
      <ChangeHighlightLayer
        pageNumber={pageNumber}
        pageIndex={pageIndex}
        renderScale={renderScale}
        variant={showCommittedOverlays ? 'edited' : 'original'}
      />
    </div>
  )
}

export function PdfWorkspace({
  zoomPercent,
  fitMode,
  activePage,
  documentSource,
  onReplacePdf,
  onRenderScaleChange,
}: PdfWorkspaceProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const leftSplitRef = useRef<HTMLDivElement>(null)
  const rightSplitRef = useRef<HTMLDivElement>(null)
  const splitSyncRef = useRef(false)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const [panning, setPanning] = useState(false)
  const { activeToolId } = useEditorSession()
  const { previewMode, viewResetToken } = useEditorPreview()
  const { exportIsModified } = useTrackedChanges()
  const singleViewLayerFlags = useMemo(
    () => workspaceCanvasLayerFlags(previewMode),
    [previewMode],
  )
  const viewportSize = useContainerSize(viewportRef)
  const { status, error, renderGeneration, source, getPageMeta } =
    usePdfViewer()

  const [pageMeta, setPageMeta] = useState<PdfPageMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'ready') {
      setPageMeta(null)
      return
    }
    let cancelled = false
    setMetaError(null)
    void getPageMeta(activePage - 1)
      .then((meta) => {
        if (!cancelled) {
          setPageMeta(meta)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMetaError('Could not read this page.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [activePage, getPageMeta, renderGeneration, status])

  const layoutWidth = useMemo(() => {
    if (previewMode !== 'side-by-side') {
      return viewportSize.width
    }
    return Math.max((viewportSize.width - 12) / 2, 120)
  }, [previewMode, viewportSize.width])

  const renderScale = useMemo(() => {
    if (!pageMeta || layoutWidth <= 0) {
      return 0
    }
    const padding = previewMode === 'side-by-side' ? 32 : 48
    const baseScale = computeFitScale(
      pageMeta.width,
      pageMeta.height,
      Math.max(layoutWidth - padding, 100),
      Math.max(viewportSize.height - padding, 160),
      fitMode,
    )
    return baseScale * (zoomPercent / 100)
  }, [pageMeta, layoutWidth, viewportSize.height, fitMode, zoomPercent, previewMode])

  useEffect(() => {
    if (renderScale > 0) {
      onRenderScaleChange?.(renderScale)
    }
  }, [renderScale, onRenderScaleChange])

  const syncSplitScroll = useCallback(
    (sourceNode: HTMLDivElement, targetNode: HTMLDivElement) => {
      if (splitSyncRef.current) {
        return
      }
      splitSyncRef.current = true
      targetNode.scrollTop = sourceNode.scrollTop
      targetNode.scrollLeft = sourceNode.scrollLeft
      splitSyncRef.current = false
    },
    [],
  )

  useEffect(() => {
    if (viewResetToken === 0) {
      return
    }
    for (const node of [viewportRef.current, leftSplitRef.current, rightSplitRef.current]) {
      node?.scrollTo({ top: 0, left: 0 })
    }
  }, [viewResetToken])

  const panActive = activeToolId === 'pan' && previewMode !== 'original'

  const handlePanPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!panActive || event.button !== 0) {
        return
      }
      const node = viewportRef.current
      if (!node) {
        return
      }
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      }
      setPanning(true)
      node.setPointerCapture(event.pointerId)
    },
    [panActive],
  )

  const handlePanPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const pan = panRef.current
      const node = viewportRef.current
      if (!pan || !node || pan.pointerId !== event.pointerId) {
        return
      }
      node.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
      node.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
    },
    [],
  )

  const endPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    const node = viewportRef.current
    if (!pan || pan.pointerId !== event.pointerId) {
      return
    }
    panRef.current = null
    setPanning(false)
    node?.releasePointerCapture(event.pointerId)
  }, [])

  const showSampleEmpty = documentSource === 'demo' && !source
  const showReuploadEmpty = documentSource === 'user' && !source
  const pageIndex = activePage - 1

  const renderPageView = (
    variant: 'original' | 'edited',
    scrollRef?: RefObject<HTMLDivElement | null>,
    onScroll?: UIEventHandler<HTMLDivElement>,
  ) => {
    const {
      showCommittedOverlays,
      showInspectLayers,
      showPendingReplacement,
    } = workspaceCanvasLayerFlags('side-by-side', variant)

    return (
      <div
        ref={scrollRef}
        className={styles.splitScroll}
        onScroll={onScroll}
      >
        <div className={styles.canvasStage}>
          <PageCanvasStack
            pageNumber={activePage}
            pageIndex={pageIndex}
            renderScale={renderScale}
            showCommittedOverlays={showCommittedOverlays}
            showInspectLayers={showInspectLayers}
            showPendingReplacement={showPendingReplacement}
            exportMatchingOnly
          />
        </div>
      </div>
    )
  }

  return (
    <main className={styles.root} aria-label="Document workspace">
      <div
        ref={viewportRef}
        className={
          panActive
            ? panning
              ? `${styles.canvasScroll} ${styles.canvasPanning}`
              : `${styles.canvasScroll} ${styles.canvasPanReady}`
            : styles.canvasScroll
        }
        onPointerDown={previewMode === 'side-by-side' ? undefined : handlePanPointerDown}
        onPointerMove={previewMode === 'side-by-side' ? undefined : handlePanPointerMove}
        onPointerUp={previewMode === 'side-by-side' ? undefined : endPan}
        onPointerCancel={previewMode === 'side-by-side' ? undefined : endPan}
      >
        {showSampleEmpty ? (
          <div className={styles.centered}>
            <EmptyState
              title="Sample document"
              description="This entry is demo metadata only. Upload a PDF from the dashboard to preview real pages here."
              icon={<FileTextOutlined />}
            />
          </div>
        ) : null}

        {showReuploadEmpty ? (
          <div className={styles.centered}>
            <EmptyState
              title="PDF not available in this session"
              description="Upload the file again to load pages in the editor. Metadata from your last visit is still listed on the dashboard."
              icon={<FileTextOutlined />}
              action={
                onReplacePdf ? (
                  <Button size="small" type="primary" onClick={onReplacePdf}>
                    Upload PDF
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : null}

        {!showSampleEmpty && !showReuploadEmpty && status === 'loading' ? (
          <div className={styles.centered}>
            <Spin tip="Opening PDF…" />
          </div>
        ) : null}

        {!showSampleEmpty && !showReuploadEmpty && status === 'error' && error ? (
          <div className={styles.centered}>
            <ErrorState title="Unable to display PDF" message={error} />
          </div>
        ) : null}

        {!showSampleEmpty &&
        !showReuploadEmpty &&
        status === 'ready' &&
        pageMeta &&
        renderScale > 0 ? (
          previewMode === 'side-by-side' ? (
            <div className={styles.splitRow}>
              <div className={styles.splitPane}>
                <Text strong className={styles.paneLabel}>
                  Original PDF
                </Text>
                {renderPageView('original', leftSplitRef, (event) => {
                  if (rightSplitRef.current) {
                    syncSplitScroll(event.currentTarget, rightSplitRef.current)
                  }
                })}
              </div>
              <div className={styles.splitPane}>
                <Text strong className={styles.paneLabel}>
                  Edited preview{exportIsModified ? ' · modified copy' : ''}
                </Text>
                {renderPageView('edited', rightSplitRef, (event) => {
                  if (leftSplitRef.current) {
                    syncSplitScroll(event.currentTarget, leftSplitRef.current)
                  }
                })}
              </div>
            </div>
          ) : (
            <div className={styles.canvasStage}>
              <PageCanvasStack
                pageNumber={activePage}
                pageIndex={pageIndex}
                renderScale={renderScale}
                showCommittedOverlays={singleViewLayerFlags.showCommittedOverlays}
                showInspectLayers={singleViewLayerFlags.showInspectLayers}
                showPendingReplacement={singleViewLayerFlags.showPendingReplacement}
              />
            </div>
          )
        ) : null}

        {!showSampleEmpty && !showReuploadEmpty && status === 'ready' && metaError ? (
          <Alert type="error" showIcon message={metaError} className={styles.metaError} />
        ) : null}
      </div>
    </main>
  )
}
