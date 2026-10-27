import type Konva from 'konva'
import { useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import {
  createPageDisplayTransform,
  screenRectToPdfRect,
} from '@/lib/pdf'
import type { PageRect } from '@/types'
import styles from './PageRegionDrawLayer.module.css'

interface PageRegionDrawLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  disabled?: boolean
  ariaLabel: string
  /** Receives the drawn rectangle in PDF user space. */
  onRegionComplete: (pdfBounds: PageRect) => void
}

interface RegionDraft {
  x1: number
  y1: number
  x2: number
  y2: number
}

const MIN_REGION_PX = 12
const BACKGROUND_NAME = 'page-region-background'

function normalizeScreenRect(draft: RegionDraft): PageRect {
  const x = Math.min(draft.x1, draft.x2)
  const y = Math.min(draft.y1, draft.y2)
  return {
    x,
    y,
    width: Math.abs(draft.x2 - draft.x1),
    height: Math.abs(draft.y2 - draft.y1),
  }
}

/** Full-page crosshair layer for dragging out a rectangle; mount only while drawing is active. */
export function PageRegionDrawLayer({
  pageNumber,
  pageIndex,
  renderScale,
  disabled = false,
  ariaLabel,
  onRegionComplete,
}: PageRegionDrawLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const [draft, setDraft] = useState<RegionDraft | null>(null)

  if (!viewport) {
    return null
  }

  const pageTransform = createPageDisplayTransform(pageIndex, viewport)

  const handlePointerDown = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    if (disabled) {
      return
    }
    const target = event.target as Konva.Node
    if (target.name() !== BACKGROUND_NAME) {
      return
    }
    const pointer = target.getStage()?.getPointerPosition()
    if (!pointer) {
      return
    }
    setDraft({ x1: pointer.x, y1: pointer.y, x2: pointer.x, y2: pointer.y })
  }

  const handlePointerMove = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    if (!draft || disabled) {
      return
    }
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) {
      return
    }
    setDraft((prev) =>
      prev ? { ...prev, x2: pointer.x, y2: pointer.y } : prev,
    )
  }

  const finalizeDraft = (): void => {
    if (!draft || disabled) {
      return
    }
    const screenRect = normalizeScreenRect(draft)
    setDraft(null)
    if (screenRect.width < MIN_REGION_PX || screenRect.height < MIN_REGION_PX) {
      return
    }
    onRegionComplete(screenRectToPdfRect(pageTransform, screenRect))
  }

  const draftRect = draft ? normalizeScreenRect(draft) : null

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-label={ariaLabel}
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={finalizeDraft}
        onTouchEnd={finalizeDraft}
      >
        <Layer>
          <Rect
            name={BACKGROUND_NAME}
            width={viewport.width}
            height={viewport.height}
            fill="rgba(15, 23, 42, 0.08)"
            listening
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
          />
          {draftRect ? (
            <Rect
              x={draftRect.x}
              y={draftRect.y}
              width={draftRect.width}
              height={draftRect.height}
              fill="rgba(59, 130, 246, 0.18)"
              stroke="#2563eb"
              dash={[5, 4]}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  )
}
