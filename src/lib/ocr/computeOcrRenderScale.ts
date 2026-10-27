import type { PageRect } from '@/types'
import { DEFAULT_OCR_RENDER_SCALE } from '@/lib/ocr/renderPageForOcr'

const MAX_OCR_SCALE = 6

/**
 * Raises render scale for small crops (e.g. prices) and low-resolution scans, and
 * never renders a scan below its own pixel density so no detail is thrown away.
 */
export function computeOcrRenderScale(input: {
  cropPdfRect: PageRect | null
  pageWidthPt: number
  pageHeightPt: number
  /** Effective pixels per point of the page's main image, when known. */
  nativePixelsPerPoint?: number | null
}): number {
  const { cropPdfRect, pageWidthPt, pageHeightPt } = input
  const native = input.nativePixelsPerPoint ?? 0
  const withNative = (scale: number): number =>
    Math.min(MAX_OCR_SCALE, Math.max(scale, Math.min(native, MAX_OCR_SCALE)))

  if (!cropPdfRect || pageWidthPt <= 0 || pageHeightPt <= 0) {
    return withNative(DEFAULT_OCR_RENDER_SCALE)
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

  return withNative(Math.min(MAX_OCR_SCALE, Math.max(DEFAULT_OCR_RENDER_SCALE, scale)))
}
