import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ExtractedPdfTextItem, TextPositionReliability } from '@/types/pdfTextInspection'
import type { PageRect } from '@/types'

interface PdfJsTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
}

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as { str: unknown }).str === 'string'
  )
}

/**
 * Bounds of a PDF.js text item in PDF user space (bottom-left origin, unrotated page),
 * which is the space `pdfRectToScreenRect` expects. `item.transform` already includes
 * the content-stream CTM, so no viewport transform is applied here.
 */
export function computeTextItemGeometry(item: {
  str: string
  transform: readonly number[]
  width: number
  height: number
}): {
  bounds: PageRect
  fontSizePt: number
  reliability: TextPositionReliability
  directionDeg: number
} {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform
  const scaleX = Math.hypot(a, b)
  const scaleY = Math.hypot(c, d)
  const fontSizePt = Math.max(scaleX, scaleY, item.height || 0, 1)

  const advance = Math.max(item.width, fontSizePt * 0.45 * Math.max(item.str.length, 1))
  const height = Math.max(item.height || fontSizePt, fontSizePt * 1.05)

  const dirX = scaleX > 0 ? a / scaleX : 1
  const dirY = scaleX > 0 ? b / scaleX : 0
  const upX = scaleY > 0 ? c / scaleY : 0
  const upY = scaleY > 0 ? d / scaleY : 1
  const below = height * 0.25
  const above = height - below

  const corners = [
    [e - upX * below, f - upY * below],
    [e + upX * above, f + upY * above],
    [e + dirX * advance - upX * below, f + dirY * advance - upY * below],
    [e + dirX * advance + upX * above, f + dirY * advance + upY * above],
  ]
  const xs = corners.map((corner) => corner[0] ?? 0)
  const ys = corners.map((corner) => corner[1] ?? 0)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)

  const bounds: PageRect = {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }

  const axisAligned = Math.abs(dirY) < 0.01 || Math.abs(dirX) < 0.01
  const reliability: TextPositionReliability =
    bounds.width > 0 &&
    bounds.height > 0 &&
    Number.isFinite(e) &&
    Number.isFinite(f) &&
    fontSizePt > 0 &&
    axisAligned
      ? 'high'
      : 'low'

  const directionDeg = ((Math.atan2(dirY, dirX) * 180) / Math.PI + 360) % 360

  return { bounds, fontSizePt, reliability, directionDeg }
}

export async function extractPageTextItems(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<ExtractedPdfTextItem[]> {
  const page = await pdf.getPage(pageIndex + 1)
  const textContent = await page.getTextContent()
  const items: ExtractedPdfTextItem[] = []

  for (const raw of textContent.items) {
    if (!isTextItem(raw)) {
      continue
    }
    if (!raw.str.trim()) {
      continue
    }
    const { bounds, fontSizePt, reliability, directionDeg } = computeTextItemGeometry(raw)
    items.push({
      id: crypto.randomUUID(),
      pageIndex,
      text: raw.str,
      bounds,
      fontName: raw.fontName ?? 'Unknown',
      fontSizePt,
      positionReliability: reliability,
      directionDeg,
    })
  }

  return items
}
