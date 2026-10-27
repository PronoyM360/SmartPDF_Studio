import { useMemo } from 'react'
import { Label, Layer, Rect, Stage, Tag, Text } from 'react-konva'
import { useTrackedChanges } from '@/features/changes/useTrackedChanges'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import styles from './ChangeHighlightLayer.module.css'

interface ChangeHighlightLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  /** "original" outlines where the change will be; "edited" outlines the result. */
  variant: 'original' | 'edited'
}

const PAD_PX = 3
const LABEL_CHAR_PX = 6.4

/** Outlines the focused tracked change at its export coordinates. */
export function ChangeHighlightLayer({ pageNumber, pageIndex, renderScale, variant }: ChangeHighlightLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { focusedChange } = useTrackedChanges()

  const transform = useMemo(
    () => (viewport ? createPageDisplayTransform(pageIndex, viewport) : null),
    [pageIndex, viewport],
  )

  if (!viewport || !transform || !focusedChange || focusedChange.pageIndex !== pageIndex) {
    return null
  }

  const box = pdfRectToScreenBounds(transform, focusedChange.bounds)
  const caption =
    variant === 'original'
      ? `Original · ${focusedChange.title}`
      : focusedChange.title
  const labelAbove = box.y > 22
  // Konva sizes the label to its text; estimate the width to keep it on the page.
  const labelWidth = caption.length * LABEL_CHAR_PX + 8
  const labelX = Math.max(0, Math.min(box.x - PAD_PX, viewport.width - labelWidth))

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-label={`Highlighted change: ${focusedChange.title}`}
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          <Rect
            x={box.x - PAD_PX}
            y={box.y - PAD_PX}
            width={box.width + PAD_PX * 2}
            height={box.height + PAD_PX * 2}
            stroke={variant === 'original' ? '#d97706' : '#7c3aed'}
            strokeWidth={2}
            dash={variant === 'original' ? [6, 4] : undefined}
            cornerRadius={3}
          />
          <Label
            x={labelX}
            y={labelAbove ? box.y - PAD_PX - 20 : box.y + box.height + PAD_PX + 2}
          >
            <Tag fill={variant === 'original' ? '#d97706' : '#7c3aed'} cornerRadius={3} />
            <Text text={caption} fontSize={11} padding={4} fill="#ffffff" />
          </Label>
        </Layer>
      </Stage>
    </div>
  )
}
