import {
  ColumnWidthOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  MinusOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import type Konva from 'konva'
import {
  Alert,
  Button,
  Modal,
  Segmented,
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildComparisonChangeSummary } from '@/features/comparison/buildComparisonChangeSummary'
import { ComparisonChangeSummaryPanel } from '@/features/comparison/ComparisonChangeSummaryPanel'
import { ComparisonPagePane } from '@/features/comparison/ComparisonPagePane'
import { useComparisonVisualDiff } from '@/features/comparison/useComparisonVisualDiff'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
} from '@/features/pdf-editor/zoomConfig'
import { useTrackedChanges } from '@/features/changes/useTrackedChanges'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from './DocumentComparisonModal.module.css'

const { Text } = Typography

type ComparisonMode = 'side-by-side' | 'overlay'

interface DocumentComparisonModalProps {
  open: boolean
  onClose: () => void
  activePage: number
  pageCount: number
  onPageChange: (page: number) => void
  zoomPercent: number
  fitMode: FitMode
  /** Export-matching committed overlays (hidden regions removed). */
  overlayObjects: readonly OverlayObject[]
}

interface CompareViewSnapshot {
  zoomPercent: number
  fitMode: FitMode
  overlayOpacity: number
  mode: ComparisonMode
  syncScroll: boolean
  showDiff: boolean
}

export function DocumentComparisonModal({
  open,
  onClose,
  activePage,
  pageCount,
  onPageChange,
  zoomPercent,
  fitMode,
  overlayObjects,
}: DocumentComparisonModalProps) {
  const { pageCount: livePageCount, renderGeneration } = usePdfViewer()
  const { undo, redo, canUndo, canRedo } = useEditorSession()
  const { exportIsModified, modifiedLabelRequired } = useTrackedChanges()
  const effectivePageCount = livePageCount || pageCount

  const leftScrollRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)
  const overlayScrollRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)

  const [mode, setMode] = useState<ComparisonMode>('side-by-side')
  const [compareZoom, setCompareZoom] = useState(zoomPercent)
  const [compareFit, setCompareFit] = useState<FitMode>(fitMode)
  const [syncScroll, setSyncScroll] = useState(true)
  const [showDiff, setShowDiff] = useState(false)
  const [overlayOpacity, setOverlayOpacity] = useState(55)
  const [fullscreen, setFullscreen] = useState(false)
  const [compareScale, setCompareScale] = useState(0)

  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null)
  const [editedStage, setEditedStage] = useState<Konva.Stage | null>(null)
  const [visualDiffByPage, setVisualDiffByPage] = useState<
    Record<number, boolean>
  >({})

  const initialSnapshotRef = useRef<CompareViewSnapshot | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const snapshot: CompareViewSnapshot = {
      zoomPercent,
      fitMode,
      overlayOpacity: 55,
      mode: 'side-by-side',
      syncScroll: true,
      showDiff: false,
    }
    initialSnapshotRef.current = snapshot
    setCompareZoom(zoomPercent)
    setCompareFit(fitMode)
    setMode('side-by-side')
    setSyncScroll(true)
    setShowDiff(false)
    setOverlayOpacity(55)
    setFullscreen(false)
    setVisualDiffByPage({})
    setBaseCanvas(null)
    setEditedStage(null)
  }, [open, zoomPercent, fitMode])

  const syncScrollPair = useCallback(
    (source: HTMLDivElement, target: HTMLDivElement) => {
      if (!syncScroll || syncingRef.current) {
        return
      }
      syncingRef.current = true
      target.scrollTop = source.scrollTop
      target.scrollLeft = source.scrollLeft
      syncingRef.current = false
    },
    [syncScroll],
  )

  const handleZoomIn = (): void => {
    setCompareZoom((value) => Math.min(MAX_ZOOM_PERCENT, value + ZOOM_STEP_PERCENT))
  }

  const handleZoomOut = (): void => {
    setCompareZoom((value) => Math.max(MIN_ZOOM_PERCENT, value - ZOOM_STEP_PERCENT))
  }

  const handleResetView = (): void => {
    const initial = initialSnapshotRef.current
    if (!initial) {
      return
    }
    setCompareZoom(initial.zoomPercent)
    setCompareFit(initial.fitMode)
    setMode(initial.mode)
    setSyncScroll(initial.syncScroll)
    setShowDiff(initial.showDiff)
    setOverlayOpacity(initial.overlayOpacity)
    for (const node of [
      leftScrollRef.current,
      rightScrollRef.current,
      overlayScrollRef.current,
    ]) {
      if (node) {
        node.scrollTop = 0
        node.scrollLeft = 0
      }
    }
  }

  const { result: diffResult, analyzing: diffAnalyzing } = useComparisonVisualDiff(
    {
      enabled: showDiff && open,
      pageIndex: activePage - 1,
      baseCanvas,
      editedStage,
      renderGeneration,
    },
  )

  useEffect(() => {
    if (!showDiff || !diffResult || diffAnalyzing) {
      return
    }
    setVisualDiffByPage((prev) => ({
      ...prev,
      [activePage - 1]: diffResult.hasMeaningfulDiff,
    }))
  }, [showDiff, diffResult, diffAnalyzing, activePage])

  const summary = useMemo(
    () =>
      buildComparisonChangeSummary(
        overlayObjects,
        visualDiffByPage,
        showDiff && !diffAnalyzing && diffResult !== null,
      ),
    [overlayObjects, visualDiffByPage, showDiff, diffAnalyzing, diffResult],
  )

  const currentPageVisualDiff =
    showDiff && diffResult && !diffAnalyzing
      ? diffResult.hasMeaningfulDiff
      : showDiff && diffAnalyzing
        ? null
        : null

  const pageOverlays = overlayObjects.filter(
    (object) => object.pageIndex === activePage - 1,
  )

  return (
    <Modal
      title="Compare original and edited"
      open={open}
      onCancel={onClose}
      footer={null}
      width={fullscreen ? '100vw' : '96vw'}
      className={fullscreen ? styles.modalFullscreen : undefined}
      styles={{
        body: { paddingTop: 8, maxHeight: fullscreen ? 'calc(100vh - 110px)' : undefined },
      }}
      destroyOnHidden
    >
      <div className={styles.layout}>
        <Alert
          type={exportIsModified ? 'warning' : 'info'}
          showIcon
          message={
            exportIsModified
              ? `Edited preview — the download is a modified copy${modifiedLabelRequired ? ' and is labelled as one' : ''}`
              : 'Visual comparison only'
          }
          description="Left: your original upload, never changed. Right: the committed edits drawn with the same data and page coordinates as the download. Highlighting shows pixel differences only; it does not prove what the file contains, and no comparison shows that a document is authentic or unchanged."
          className={styles.alert}
        />

        <div className={styles.toolbar}>
          <Space wrap size={8}>
            <Segmented
              size="small"
              value={mode}
              onChange={(value) => setMode(value as ComparisonMode)}
              options={[
                { label: 'Side by side', value: 'side-by-side' },
                { label: 'Overlay', value: 'overlay' },
              ]}
            />
            <Button
              size="small"
              disabled={activePage <= 1}
              onClick={() => onPageChange(activePage - 1)}
            >
              Previous
            </Button>
            <Text type="secondary" className={styles.pageIndicator}>
              Page {activePage} / {effectivePageCount}
            </Text>
            <Button
              size="small"
              disabled={activePage >= effectivePageCount}
              onClick={() => onPageChange(activePage + 1)}
            >
              Next
            </Button>
            <Tooltip title="Undo last edit (Ctrl+Z)">
              <Button size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} aria-label="Undo" />
            </Tooltip>
            <Tooltip title="Redo (Ctrl+Y)">
              <Button size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} aria-label="Redo" />
            </Tooltip>
          </Space>

          <Space wrap size={8}>
            <Tooltip title="Zoom out">
              <Button size="small" icon={<MinusOutlined />} onClick={handleZoomOut} />
            </Tooltip>
            <Text type="secondary" className={styles.zoomLabel}>
              {compareZoom}%
            </Text>
            <Tooltip title="Zoom in">
              <Button size="small" icon={<PlusOutlined />} onClick={handleZoomIn} />
            </Tooltip>
            <Button
              size="small"
              type={compareFit === 'page' ? 'primary' : 'default'}
              icon={<FullscreenOutlined />}
              onClick={() => setCompareFit('page')}
            >
              Fit page
            </Button>
            <Button
              size="small"
              type={compareFit === 'width' ? 'primary' : 'default'}
              icon={<ColumnWidthOutlined />}
              onClick={() => setCompareFit('width')}
            >
              Fit width
            </Button>
            <Tooltip title="Reset zoom, fit, scroll, and overlay opacity">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleResetView}
              >
                Reset
              </Button>
            </Tooltip>
            <Tooltip
              title={
                fullscreen ? 'Exit full screen' : 'Full screen comparison'
              }
            >
              <Button
                size="small"
                icon={
                  fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />
                }
                onClick={() => setFullscreen((value) => !value)}
                aria-pressed={fullscreen}
              />
            </Tooltip>
          </Space>

          <Space wrap size={12} className={styles.toolbarFlags}>
            {mode === 'side-by-side' ? (
              <label className={styles.switchLabel}>
                <Switch
                  size="small"
                  checked={syncScroll}
                  onChange={setSyncScroll}
                />
                Sync scroll
              </label>
            ) : null}
            <label className={styles.switchLabel}>
              <Switch
                size="small"
                checked={showDiff}
                onChange={setShowDiff}
              />
              Highlight differences
            </label>
            {showDiff ? (
              <Tag color="processing" className={styles.legendTag}>
                <span className={styles.legendSwatch} aria-hidden />
                Visual diff (not text proof)
              </Tag>
            ) : null}
          </Space>
        </div>

        {mode === 'overlay' ? (
          <div className={styles.overlayControls}>
            <Text type="secondary">Edited overlay opacity</Text>
            <Slider
              min={0}
              max={100}
              value={overlayOpacity}
              onChange={setOverlayOpacity}
              className={styles.opacitySlider}
              tooltip={{ formatter: (value) => `${value}%` }}
            />
          </div>
        ) : null}

        <div className={styles.body}>
          <div className={styles.workspace}>
            {mode === 'side-by-side' ? (
              <div className={styles.columns}>
                <div className={styles.column}>
                  <Text strong className={styles.columnTitle}>
                    Original PDF
                  </Text>
                  <div
                    ref={leftScrollRef}
                    className={styles.scroll}
                    onScroll={(event) => {
                      if (rightScrollRef.current) {
                        syncScrollPair(event.currentTarget, rightScrollRef.current)
                      }
                    }}
                  >
                    <ComparisonPagePane
                      pageNumber={activePage}
                      pageIndex={activePage - 1}
                      zoomPercent={compareZoom}
                      fitMode={compareFit}
                      variant="original"
                      overlayObjects={[]}
                      onRenderScaleChange={setCompareScale}
                      onBaseCanvasReady={setBaseCanvas}
                    />
                  </div>
                </div>
                <div className={styles.column}>
                  <Text strong className={styles.columnTitle}>
                    Edited preview
                    {exportIsModified ? (
                      <Tag color="warning" className={styles.modifiedTag}>
                        Modified copy
                      </Tag>
                    ) : null}
                  </Text>
                  <div
                    ref={rightScrollRef}
                    className={styles.scroll}
                    onScroll={(event) => {
                      if (leftScrollRef.current) {
                        syncScrollPair(event.currentTarget, leftScrollRef.current)
                      }
                    }}
                  >
                    <ComparisonPagePane
                      pageNumber={activePage}
                      pageIndex={activePage - 1}
                      zoomPercent={compareZoom}
                      fitMode={compareFit}
                      variant="edited"
                      overlayObjects={overlayObjects}
                      showOverlayPreview
                      onRenderScaleChange={setCompareScale}
                      onEditedStageReady={setEditedStage}
                      showDiffHeatmap={showDiff}
                      diffResult={diffResult}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.overlayColumn}>
                <Text strong className={styles.columnTitle}>
                  Overlay — Original underneath · Edited overlays on top
                </Text>
                <div ref={overlayScrollRef} className={styles.scroll}>
                  <ComparisonPagePane
                    pageNumber={activePage}
                    pageIndex={activePage - 1}
                    zoomPercent={compareZoom}
                    fitMode={compareFit}
                    variant="edited"
                    overlayObjects={overlayObjects}
                    showOverlayPreview
                    overlayOpacity={overlayOpacity / 100}
                    onRenderScaleChange={setCompareScale}
                    onBaseCanvasReady={setBaseCanvas}
                    onEditedStageReady={setEditedStage}
                    showDiffHeatmap={showDiff}
                    diffResult={diffResult}
                  />
                </div>
              </div>
            )}
          </div>

          <ComparisonChangeSummaryPanel
            summary={summary}
            activePage={activePage}
            pageCount={effectivePageCount}
            currentPageVisualDiff={currentPageVisualDiff}
            onNavigateToPage={onPageChange}
          />
        </div>

        <div className={styles.footerMeta}>
          {pageOverlays.length === 0 ? (
            <Text type="secondary">
              No overlays on this page — edited view matches original PDF.
            </Text>
          ) : (
            <Text type="secondary">
              {pageOverlays.length} overlay
              {pageOverlays.length === 1 ? '' : 's'} on this page.
            </Text>
          )}
          {compareScale > 0 ? (
            <Text type="secondary">
              Preview scale {compareScale.toFixed(2)}× (capped for performance)
            </Text>
          ) : null}
          {showDiff && diffAnalyzing ? (
            <Text type="secondary">Analyzing visual differences…</Text>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
