import { Spin } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePdfFromBytes } from '@/features/export/usePdfFromBytes'
import { PdfPageCanvas } from '@/features/pdf-viewer/PdfPageCanvas'
import { useContainerSize } from '@/hooks/useContainerSize'
import { computeFitScale } from '@/lib/pdf'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import type { PdfPageMeta } from '@/types'
import styles from '@/features/comparison/ComparisonPagePane.module.css'

interface ExportedComparisonPagePaneProps {
  exportedBytes: Uint8Array
  pageNumber: number
  pageIndex: number
  zoomPercent: number
  fitMode: FitMode
}

export function ExportedComparisonPagePane({
  exportedBytes,
  pageNumber,
  pageIndex,
  zoomPercent,
  fitMode,
}: ExportedComparisonPagePaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewportSize = useContainerSize(viewportRef)
  const { status, pageCount, renderGeneration, pdf, getPageMeta } =
    usePdfFromBytes(exportedBytes)
  const [pageMeta, setPageMeta] = useState<PdfPageMeta | null>(null)

  useEffect(() => {
    if (status !== 'ready') {
      setPageMeta(null)
      return
    }
    if (pageIndex >= pageCount) {
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
  }, [pageIndex, getPageMeta, renderGeneration, status, pageCount])

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
    return Math.min(scaled, 2.5)
  }, [pageMeta, viewportSize, fitMode, zoomPercent])

  if (status === 'loading') {
    return (
      <div ref={viewportRef} className={styles.loading}>
        <Spin size="small" tip="Opening exported PDF…" />
      </div>
    )
  }

  if (status === 'error' || pageIndex >= pageCount) {
    return (
      <div ref={viewportRef} className={styles.loading}>
        <span>Exported page unavailable.</span>
      </div>
    )
  }

  if (!pageMeta || renderScale <= 0) {
    return (
      <div ref={viewportRef} className={styles.loading}>
        <Spin size="small" />
      </div>
    )
  }

  return (
    <div ref={viewportRef} className={styles.root}>
      <div className={styles.stack}>
        <PdfPageCanvas
          pageNumber={pageNumber}
          scale={renderScale}
          pdfDocument={pdf}
          renderKey={renderGeneration}
          ariaLabel={`Exported PDF page ${pageNumber}`}
        />
      </div>
    </div>
  )
}
