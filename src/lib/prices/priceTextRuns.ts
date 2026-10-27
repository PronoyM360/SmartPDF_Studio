import type { PageRect } from '@/types'
import type { OcrTextItem } from '@/types/ocr'
import type { ExtractedPdfTextItem } from '@/types/pdfTextInspection'
import type { PriceTextRun } from '@/types/priceEditing'

/** OCR digit boxes cover roughly the cap height, ~72% of the font size. */
const OCR_CAP_HEIGHT_RATIO = 0.72

export function pdfItemsToPriceRuns(items: readonly ExtractedPdfTextItem[]): PriceTextRun[] {
  return items.map((item) => ({
    id: item.id,
    pageIndex: item.pageIndex,
    text: item.text,
    bounds: item.bounds,
    fontName: item.fontName,
    fontSizePt: item.fontSizePt,
    baseline: item.baseline ?? null,
    advanceWidth: item.advanceWidth ?? null,
    directionDeg: item.directionDeg ?? 0,
    positionReliability: item.positionReliability,
    source: 'pdf_text',
    ocrConfidence: null,
  }))
}

function intersectionArea(a: PageRect, b: PageRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * OCR words → runs, keeping only words that are not already selectable PDF text,
 * so hybrid pages only add amounts that live inside images.
 */
export function ocrItemsToPriceRuns(
  items: readonly OcrTextItem[],
  selectable: readonly { readonly bounds: PageRect }[],
): PriceTextRun[] {
  return items
    .filter((item) => item.kind === 'word' && item.text.trim())
    .filter((item) => {
      const area = item.bounds.width * item.bounds.height
      return area > 0 && !selectable.some((run) => intersectionArea(run.bounds, item.bounds) >= area * 0.5)
    })
    .map((item) => ({
      id: item.id,
      pageIndex: item.pageIndex,
      text: item.text,
      bounds: item.bounds,
      fontName: 'OCR',
      fontSizePt: Math.max(item.bounds.height / OCR_CAP_HEIGHT_RATIO, 4),
      baseline: null,
      advanceWidth: item.bounds.width,
      directionDeg: 0,
      positionReliability: 'low',
      source: 'ocr',
      ocrConfidence: item.confidence,
    }))
}
