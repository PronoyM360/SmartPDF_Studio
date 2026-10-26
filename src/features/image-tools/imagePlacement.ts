import type { PagePoint, PageRect } from '@/types'

const MAX_WIDTH_PT = 240

export function computeImageBoundsAtPoint(
  pdfPoint: PagePoint,
  pixelWidth: number,
  pixelHeight: number,
): PageRect {
  const safeWidth = Math.max(pixelWidth, 1)
  const safeHeight = Math.max(pixelHeight, 1)
  const width = Math.min(MAX_WIDTH_PT, safeWidth)
  const height = (safeHeight / safeWidth) * width
  return {
    x: pdfPoint.x,
    y: pdfPoint.y,
    width,
    height,
  }
}
