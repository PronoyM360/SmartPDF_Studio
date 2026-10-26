import type Konva from 'konva'
import { useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import {
  createPageDisplayTransform,
  screenRectToPdfRect,
} from '@/lib/pdf'
import type { PageRect } from '@/types'
import styles from './OcrRegionSelectLayer.module.css'

interface OcrRegionSelectLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

interface RegionDraft {
  x1: number
  y1: number
  x2: number
  y2: number
}

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

export function OcrRegionSelectLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: OcrRegionSelectLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { regionSelectActive, setRegionSelectActive, runOcrOnRegion, job } =
    useOcrSession()
  const [draft, setDraft] = useState<RegionDraft | null>(null)

  if (!regionSelectActive || !viewport) {
    return null
  }

  const pageTransform = createPageDisplayTransform(pageIndex, viewport)
  const busy =
    job.status === 'rendering' ||
    job.status === 'loading-worker' ||
    job.status === 'recognizing'

  const handlePointerDown = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    if (busy) {
      return
    }
    const target = event.target as Konva.Node
    if (target.name() !== 'ocr-region-background') {
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
    if (!draft || busy) {
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
    if (!draft || busy) {
      return
    }
    const screenRect = normalizeScreenRect(draft)
    setDraft(null)
    if (screenRect.width < 12 || screenRect.height < 12) {
      return
    }
    const pdfBounds = screenRectToPdfRect(pageTransform, screenRect)
    setRegionSelectActive(false)
    runOcrOnRegion(pdfBounds)
  }

  const draftRect = draft ? normalizeScreenRect(draft) : null

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-label="OCR region selection"
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
            name="ocr-region-background"
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
