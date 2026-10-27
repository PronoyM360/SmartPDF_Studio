import type { PDFFont } from 'pdf-lib'
import type { PageRect } from '@/types'

export const TEXT_OVERLAY_LINE_HEIGHT_RATIO = 1.25

/**
 * Distance from the text box top to the first baseline, computed the way Konva lays
 * out text (lineHeight 1, `verticalAlign="top"`), so canvas export matches the editor.
 * `ctx.font` must already be set to the overlay font at `fontSize` units.
 */
export function konvaFirstBaselineOffset(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  fontSize: number,
): number {
  const metrics = ctx.measureText('M')
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
  return (ascent - descent) / 2 + fontSize / 2
}

/** Baseline Y (PDF user space) for a line, top-aligned like Konva `verticalAlign="top"`. */
export function textLineBaselineY(
  bounds: PageRect,
  font: PDFFont,
  fontSize: number,
  lineIndex: number,
  lineHeight = fontSize * TEXT_OVERLAY_LINE_HEIGHT_RATIO,
): number {
  const top = bounds.y + bounds.height
  const lineTop = top - lineIndex * lineHeight
  const ascentBlock = font.heightAtSize(fontSize, { descender: false })
  return lineTop - ascentBlock
}
