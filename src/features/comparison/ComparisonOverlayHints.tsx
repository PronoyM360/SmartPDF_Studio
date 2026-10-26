import { useMemo } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenRect } from '@/lib/pdf'
import {
  isImageOverlay,
  isMaskOverlay,
  isTextOverlay,
} from '@/types/overlayObjects'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from './ComparisonOverlayHints.module.css'

interface ComparisonOverlayHintsProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  overlayObjects: readonly OverlayObject[]
}

export function ComparisonOverlayHints({
  pageNumber,
  pageIndex,
  renderScale,
  overlayObjects,
}: ComparisonOverlayHintsProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  const pageObjects = overlayObjects.filter(
    (object) => object.pageIndex === pageIndex,
  )

  if (!viewport || !pageTransform || pageObjects.length === 0) {
    return null
  }

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-hidden
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {pageObjects.map((object) => {
            const screen = pdfRectToScreenRect(pageTransform, object.bounds)
            const stroke = isMaskOverlay(object)
              ? '#f59e0b'
              : isTextOverlay(object)
                ? '#2563eb'
                : isImageOverlay(object)
                  ? '#16a34a'
                  : '#64748b'
            return (
              <Rect
                key={object.id}
                x={screen.x}
                y={screen.y}
                width={screen.width}
                height={screen.height}
                stroke={stroke}
                strokeWidth={2}
                dash={[6, 4]}
                fill={
                  isMaskOverlay(object)
                    ? 'rgba(245, 158, 11, 0.12)'
                    : 'rgba(37, 99, 235, 0.08)'
                }
              />
            )
          })}
        </Layer>
      </Stage>
    </div>
  )
}
