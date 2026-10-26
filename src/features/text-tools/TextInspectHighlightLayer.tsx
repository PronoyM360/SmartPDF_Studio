import { useMemo } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { usePdfTextInspect } from '@/features/text-tools/PdfTextInspectContext'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenRect } from '@/lib/pdf'
import styles from './TextInspectHighlightLayer.module.css'

interface TextInspectHighlightLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

export function TextInspectHighlightLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: TextInspectHighlightLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { searchResults, activeResultIndex, selectedItem, adjustmentBounds } =
    usePdfTextInspect()

  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  if (!viewport || !pageTransform) {
    return null
  }

  const pageResults = searchResults.filter((result) => result.pageIndex === pageIndex)
  const activeResult = searchResults[activeResultIndex]

  const selectedBounds =
    adjustmentBounds ??
    (selectedItem?.pageIndex === pageIndex ? selectedItem.bounds : null)

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-hidden
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {pageResults.map((result) => {
            const highlightBounds = result.matchBounds
            const screen = pdfRectToScreenRect(pageTransform, highlightBounds)
            const isActive = activeResult?.id === result.id
            const lowConfidence = result.positionReliability === 'low'
            return (
              <Rect
                key={result.id}
                x={screen.x}
                y={screen.y}
                width={screen.width}
                height={screen.height}
                fill={
                  isActive
                    ? lowConfidence
                      ? 'rgba(251, 146, 60, 0.45)'
                      : 'rgba(251, 191, 36, 0.45)'
                    : lowConfidence
                      ? 'rgba(253, 186, 116, 0.35)'
                      : 'rgba(250, 204, 21, 0.28)'
                }
                stroke={isActive ? '#d97706' : lowConfidence ? '#ea580c' : '#f59e0b'}
                strokeWidth={isActive ? 2 : 1}
              />
            )
          })}
          {selectedBounds && selectedItem?.pageIndex === pageIndex ? (
            <Rect
              x={pdfRectToScreenRect(pageTransform, selectedBounds).x}
              y={pdfRectToScreenRect(pageTransform, selectedBounds).y}
              width={pdfRectToScreenRect(pageTransform, selectedBounds).width}
              height={pdfRectToScreenRect(pageTransform, selectedBounds).height}
              stroke="#2563eb"
              dash={[6, 4]}
              strokeWidth={1.5}
              fill="rgba(37, 99, 235, 0.08)"
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
