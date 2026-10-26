import { useEffect, useRef } from 'react'
import { pdfRectToScreenRect } from '@/lib/pdf'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import styles from './MaskBeforeAfterPreview.module.css'

interface MaskBeforeAfterPreviewProps {
  pageNumber: number
  transform: PageDisplayTransform
  mask: MaskOverlayObject
}

function drawPreview(
  canvas: HTMLCanvasElement,
  pageCanvas: HTMLCanvasElement,
  transform: PageDisplayTransform,
  mask: MaskOverlayObject,
  showMask: boolean,
): void {
  const screen = pdfRectToScreenRect(transform, mask.bounds)
  const width = Math.max(48, Math.floor(screen.width))
  const height = Math.max(48, Math.floor(screen.height))
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const pageRect = pageCanvas.getBoundingClientRect()
  const scaleX = pageCanvas.width / pageRect.width
  const scaleY = pageCanvas.height / pageRect.height
  const sourceX = screen.x * scaleX
  const sourceY = screen.y * scaleY
  const sourceW = screen.width * scaleX
  const sourceH = screen.height * scaleY

  context.drawImage(
    pageCanvas,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    width,
    height,
  )

  if (showMask) {
    context.globalAlpha = mask.opacity
    context.fillStyle = mask.fillColor
    context.fillRect(0, 0, width, height)
    context.globalAlpha = 1
  }
}

export function MaskBeforeAfterPreview({
  pageNumber,
  transform,
  mask,
}: MaskBeforeAfterPreviewProps) {
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const pageCanvas = document.querySelector(
      `canvas[aria-label="PDF page ${pageNumber}"]`,
    )
    if (!(pageCanvas instanceof HTMLCanvasElement)) {
      return
    }
    const before = beforeRef.current
    const after = afterRef.current
    if (!before || !after) {
      return
    }
    drawPreview(before, pageCanvas, transform, mask, false)
    drawPreview(after, pageCanvas, transform, mask, true)
  }, [pageNumber, transform, mask])

  return (
    <div className={styles.root}>
      <div className={styles.panel}>
        <span className={styles.label}>Before</span>
        <canvas ref={beforeRef} className={styles.canvas} aria-label="Before mask preview" />
      </div>
      <div className={styles.panel}>
        <span className={styles.label}>After (cover)</span>
        <canvas ref={afterRef} className={styles.canvas} aria-label="After mask preview" />
      </div>
    </div>
  )
}
