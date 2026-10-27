import { Typography } from 'antd'
import { useEffect, useRef } from 'react'
import type { OcrRegionRepairResult } from '@/features/ocr/useOcrRegionRepair'
import { konvaFirstBaselineOffset } from '@/lib/pdf/export/textOverlayLayout'
import type { TextAlignment } from '@/types/textOverlay'
import type { PageRect } from '@/types'
import styles from './OcrRepairPreview.module.css'

const { Text } = Typography

/** Previews are drawn at ≥ 3 px/pt so low-resolution scans stay readable on screen. */
const MIN_PREVIEW_PIXELS_PER_POINT = 3
const MAX_PREVIEW_WIDTH = 2400

export interface OcrPreviewText {
  readonly content: string
  /** Display-space box in points (scale 1). */
  readonly displayBox: PageRect
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: 'normal' | 'bold'
  readonly color: string
  readonly alignment: TextAlignment
  readonly letterSpacing: number
}

interface OcrRepairPreviewProps {
  result: OcrRegionRepairResult
  text: OcrPreviewText | null
  flatCover: { displayBox: PageRect; color: string } | null
  showRepairMask: boolean
}

function scratchCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function release(...canvases: HTMLCanvasElement[]): void {
  for (const canvas of canvases) {
    canvas.width = 0
    canvas.height = 0
  }
}

export function OcrRepairPreview({ result, text, flatCover, showRepairMask }: OcrRepairPreviewProps) {
  const beforeRef = useRef<HTMLCanvasElement>(null)
  const afterRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const before = beforeRef.current
    const after = afterRef.current
    if (!before || !after) {
      return
    }
    const { context, pixelsPerPoint: ppp, contextDisplayBox, repair, repairOffsetPx } = result
    let scale = Math.max(1, MIN_PREVIEW_PIXELS_PER_POINT / ppp)
    if (context.width * scale > MAX_PREVIEW_WIDTH) {
      scale = MAX_PREVIEW_WIDTH / context.width
    }
    const width = Math.max(1, Math.round(context.width * scale))
    const height = Math.max(1, Math.round(context.height * scale))

    const original = scratchCanvas(context.width, context.height)
    const composed = scratchCanvas(context.width, context.height)
    const patch = scratchCanvas(repair?.width ?? 1, repair?.height ?? 1)
    try {
      original.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(context.data), context.width, context.height), 0, 0)

      const composedCtx = composed.getContext('2d')
      if (!composedCtx) {
        return
      }
      composedCtx.drawImage(original, 0, 0)
      if (repair) {
        patch.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(repair.pixels), repair.width, repair.height), 0, 0)
        composedCtx.drawImage(patch, repairOffsetPx.x, repairOffsetPx.y)
        if (showRepairMask) {
          const tint = scratchCanvas(repair.width, repair.height)
          const tintCtx = tint.getContext('2d')
          if (tintCtx) {
            tintCtx.drawImage(patch, 0, 0)
            tintCtx.globalCompositeOperation = 'source-in'
            tintCtx.fillStyle = 'rgba(239, 68, 68, 0.6)'
            tintCtx.fillRect(0, 0, repair.width, repair.height)
            composedCtx.drawImage(tint, repairOffsetPx.x, repairOffsetPx.y)
          }
          release(tint)
        }
      }
      if (flatCover) {
        composedCtx.fillStyle = flatCover.color
        composedCtx.fillRect(
          (flatCover.displayBox.x - contextDisplayBox.x) * ppp,
          (flatCover.displayBox.y - contextDisplayBox.y) * ppp,
          flatCover.displayBox.width * ppp,
          flatCover.displayBox.height * ppp,
        )
      }

      for (const [target, source] of [
        [before, original],
        [after, composed],
      ] as const) {
        target.width = width
        target.height = height
        const ctx = target.getContext('2d')
        if (!ctx) {
          continue
        }
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(source, 0, 0, width, height)
      }

      const ctx = after.getContext('2d')
      if (ctx && text && text.content.trim()) {
        const s = ppp * scale
        const size = text.fontSize * s
        ctx.font = `${text.fontWeight} ${size}px ${text.fontFamily}, sans-serif`
        ctx.fillStyle = text.color
        ctx.textBaseline = 'alphabetic'
        const boxX = (text.displayBox.x - contextDisplayBox.x) * s
        const boxWidth = text.displayBox.width * s
        const baseline = (text.displayBox.y - contextDisplayBox.y) * s + konvaFirstBaselineOffset(ctx, size)
        const spacing = text.letterSpacing * s
        const chars = [...text.content]
        const lineWidth = ctx.measureText(text.content).width + spacing * chars.length
        let x = boxX
        if (text.alignment === 'right') {
          x = boxX + boxWidth - lineWidth
        } else if (text.alignment === 'center') {
          x = boxX + (boxWidth - lineWidth) / 2
        }
        if (!spacing) {
          ctx.fillText(text.content, x, baseline)
        } else {
          for (const char of chars) {
            ctx.fillText(char, x, baseline)
            x += ctx.measureText(char).width + spacing
          }
        }
      }
    } finally {
      release(original, composed, patch)
    }
  }, [result, text, flatCover, showRepairMask])

  useEffect(() => {
    const before = beforeRef.current
    const after = afterRef.current
    return () => {
      if (before) {
        release(before)
      }
      if (after) {
        release(after)
      }
    }
  }, [])

  return (
    <div className={styles.root}>
      <div className={styles.pane}>
        <Text type="secondary" className={styles.label}>
          Original scan
        </Text>
        <canvas ref={beforeRef} className={styles.canvas} aria-label="Original region" />
      </div>
      <div className={styles.pane}>
        <Text type="secondary" className={styles.label}>
          After (as exported){showRepairMask ? ' — repaired pixels tinted red' : ''}
        </Text>
        <canvas ref={afterRef} className={styles.canvas} aria-label="Edited region preview" />
      </div>
    </div>
  )
}
