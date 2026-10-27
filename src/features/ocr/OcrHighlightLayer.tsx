import { useMemo } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { ocrConfidenceTier } from '@/lib/ocr/ocrConfidence'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import styles from './OcrHighlightLayer.module.css'

interface OcrHighlightLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

export function OcrHighlightLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: OcrHighlightLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { pageResult, visibleItems, selectedItemId, adjustmentBounds } = useOcrSession()

  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  if (!viewport || !pageTransform || !pageResult || pageResult.pageIndex !== pageIndex) {
    return null
  }

  const selectedBounds =
    adjustmentBounds ??
    pageResult.items.find((item) => item.id === selectedItemId)?.bounds ??
    null
  const selectedScreen = selectedBounds ? pdfRectToScreenBounds(pageTransform, selectedBounds) : null

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-hidden
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {visibleItems.map((item) => {
            const screen = pdfRectToScreenBounds(pageTransform, item.bounds)
            const isSelected = item.id === selectedItemId
            const isPrice = item.tags.includes('price')
            const lowConfidence = ocrConfidenceTier(item.confidence) === 'low'
            return (
              <Rect
                key={item.id}
                x={screen.x}
                y={screen.y}
                width={screen.width}
                height={screen.height}
                fill={
                  isSelected
                    ? 'rgba(59, 130, 246, 0.42)'
                    : lowConfidence
                      ? 'rgba(251, 191, 36, 0.28)'
                      : isPrice
                        ? 'rgba(167, 139, 250, 0.32)'
                        : 'rgba(34, 197, 94, 0.22)'
                }
                stroke={
                  isSelected
                    ? '#1d4ed8'
                    : lowConfidence
                      ? '#d97706'
                      : isPrice
                        ? '#7c3aed'
                        : '#16a34a'
                }
                strokeWidth={isSelected ? 2 : 1}
                dash={lowConfidence ? [4, 3] : undefined}
              />
            )
          })}
          {selectedScreen ? (
            <Rect
              x={selectedScreen.x}
              y={selectedScreen.y}
              width={selectedScreen.width}
              height={selectedScreen.height}
              stroke="#1d4ed8"
              dash={[6, 4]}
              strokeWidth={1.5}
              fill="rgba(37, 99, 235, 0.06)"
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
