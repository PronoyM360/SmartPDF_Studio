import { Spin } from 'antd'
import type Konva from 'konva'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChangeHighlightLayer } from '@/features/changes/ChangeHighlightLayer'
import { ComparisonDiffHeatmap } from '@/features/comparison/ComparisonDiffHeatmap'
import { ComparisonOverlayHints } from '@/features/comparison/ComparisonOverlayHints'
import { ComparisonOverlayPreview } from '@/features/comparison/ComparisonOverlayPreview'
import { PdfPageCanvas } from '@/features/pdf-viewer/PdfPageCanvas'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { useContainerSize } from '@/hooks/useContainerSize'
import { computeFitScale } from '@/lib/pdf'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import type { PdfPageMeta } from '@/types'
import type { PixelDiffResult } from '@/features/comparison/computeCanvasPixelDiff'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from './ComparisonPagePane.module.css'

const MAX_COMPARE_SCALE = 2.5

interface ComparisonPagePaneProps {
  pageNumber: number
  pageIndex: number
  zoomPercent: number
  fitMode: FitMode
  variant: 'original' | 'edited'
  overlayObjects: readonly OverlayObject[]
  showBoundsHints?: boolean
  showOverlayPreview?: boolean
  overlayOpacity?: number
  onRenderScaleChange?: (scale: number) => void
  onBaseCanvasReady?: (canvas: HTMLCanvasElement | null) => void
  onEditedStageReady?: (stage: Konva.Stage | null) => void
  diffResult?: PixelDiffResult | null
  showDiffHeatmap?: boolean
}

export function ComparisonPagePane({
  pageNumber,
  pageIndex,
  zoomPercent,
  fitMode,
  variant,
  overlayObjects,
  showBoundsHints = false,
  showOverlayPreview = true,
  overlayOpacity = 1,
  onRenderScaleChange,
  onBaseCanvasReady,
  onEditedStageReady,
  diffResult,
  showDiffHeatmap = false,
}: ComparisonPagePaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportSize = useContainerSize(viewportRef)
  const { status, getPageMeta, renderGeneration } = usePdfViewer()
  const [pageMeta, setPageMeta] = useState<PdfPageMeta | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

  useEffect(() => {
    if (status !== 'ready') {
      setPageMeta(null)
      return
    }
    let cancelled = false
    void getPageMeta(pageIndex)
      .then((meta) => {
        if (!cancelled) {
          setPageMeta(meta)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPageMeta(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [pageIndex, getPageMeta, renderGeneration, status])

  const renderScale = useMemo(() => {
    if (!pageMeta || viewportSize.width <= 0) {
      return 0
    }
    const padding = 24
    const baseScale = computeFitScale(
      pageMeta.width,
      pageMeta.height,
      Math.max(viewportSize.width - padding, 100),
      Math.max(viewportSize.height - padding, 120),
      fitMode,
    )
    const scaled = baseScale * (zoomPercent / 100)
    return Math.min(scaled, MAX_COMPARE_SCALE)
  }, [pageMeta, viewportSize, fitMode, zoomPercent])

  useEffect(() => {
    if (renderScale > 0) {
      onRenderScaleChange?.(renderScale)
    }
  }, [renderScale, onRenderScaleChange])

  const handleCanvasReady = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      onBaseCanvasReady?.(canvas)
    },
    [onBaseCanvasReady],
  )

  const handleStageReady = useCallback(
    (stage: Konva.Stage | null) => {
      stageRef.current = stage
      if (variant === 'edited') {
        onEditedStageReady?.(stage)
      }
    },
    [variant, onEditedStageReady],
  )

  useEffect(() => {
    return () => {
      onBaseCanvasReady?.(null)
      onEditedStageReady?.(null)
    }
  }, [onBaseCanvasReady, onEditedStageReady])

  if (status !== 'ready' || !pageMeta || renderScale <= 0) {
    return (
      <div ref={viewportRef} className={styles.loading}>
        <Spin size="small" />
      </div>
    )
  }

  const displayWidth = pageMeta.width * renderScale
  const displayHeight = pageMeta.height * renderScale

  return (
    <div ref={viewportRef} className={styles.root}>
      <div
        className={styles.stack}
        style={{ width: displayWidth, height: displayHeight }}
      >
        <PdfPageCanvas
          pageNumber={pageNumber}
          scale={renderScale}
          onCanvasReady={handleCanvasReady}
        />
        {variant === 'edited' && showOverlayPreview ? (
          <div
            className={styles.overlayLayer}
            style={{ opacity: overlayOpacity }}
          >
            <ComparisonOverlayPreview
              pageNumber={pageNumber}
              pageIndex={pageIndex}
              renderScale={renderScale}
              overlayObjects={overlayObjects}
              onStageReady={handleStageReady}
            />
          </div>
        ) : null}
        <ChangeHighlightLayer
          pageNumber={pageNumber}
          pageIndex={pageIndex}
          renderScale={renderScale}
          variant={variant}
        />
        {variant === 'edited' && showBoundsHints ? (
          <ComparisonOverlayHints
            pageIndex={pageIndex}
            pageNumber={pageNumber}
            renderScale={renderScale}
            overlayObjects={overlayObjects}
          />
        ) : null}
        {variant === 'edited' &&
        showDiffHeatmap &&
        diffResult?.heatmap &&
        diffResult.width > 0 ? (
          <ComparisonDiffHeatmap
            heatmap={diffResult.heatmap}
            sourceWidth={diffResult.width}
            sourceHeight={diffResult.height}
            displayWidth={displayWidth}
            displayHeight={displayHeight}
          />
        ) : null}
      </div>
    </div>
  )
}
