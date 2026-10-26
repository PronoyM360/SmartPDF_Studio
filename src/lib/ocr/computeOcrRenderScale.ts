import type { PageRect } from '@/types'
import { DEFAULT_OCR_RENDER_SCALE } from '@/lib/ocr/renderPageForOcr'

const MAX_OCR_SCALE = 6

/** Raises render scale for small crops (e.g. prices) and low-resolution scans. */
export function computeOcrRenderScale(input: {
  cropPdfRect: PageRect | null
  pageWidthPt: number
  pageHeightPt: number
}): number {
  const { cropPdfRect, pageWidthPt, pageHeightPt } = input
  if (!cropPdfRect || pageWidthPt <= 0 || pageHeightPt <= 0) {
    return DEFAULT_OCR_RENDER_SCALE
  }

  const pageArea = pageWidthPt * pageHeightPt
  const cropArea = cropPdfRect.width * cropPdfRect.height
  const areaRatio = cropArea / pageArea

  const minDimension = Math.min(cropPdfRect.width, cropPdfRect.height)
  let scale = DEFAULT_OCR_RENDER_SCALE

  if (areaRatio < 0.015 || minDimension < 18) {
    scale = DEFAULT_OCR_RENDER_SCALE * 1.75
  } else if (areaRatio < 0.06 || minDimension < 36) {
    scale = DEFAULT_OCR_RENDER_SCALE * 1.35
  }

  return Math.min(MAX_OCR_SCALE, Math.max(DEFAULT_OCR_RENDER_SCALE, scale))
}
