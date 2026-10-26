import { Util, type PDFDocumentProxy } from 'pdfjs-dist'
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

function computeTextItemGeometry(
  item: PdfJsTextItem,
  viewportTransform: number[],
): {
  bounds: PageRect
  fontSizePt: number
  reliability: TextPositionReliability
} {
  const transform = Util.transform(viewportTransform, item.transform)
  const scaleX = Math.hypot(transform[0] ?? 0, transform[1] ?? 0)
  const scaleY = Math.hypot(transform[2] ?? 0, transform[3] ?? 0)
  const fontSizePt = Math.max(scaleX, scaleY, item.height || 0, 1)

  const width = Math.max(item.width, fontSizePt * 0.45 * Math.max(item.str.length, 1))
  const height = Math.max(item.height || fontSizePt, fontSizePt * 1.05)

  const x = transform[4] ?? 0
  const baselineY = transform[5] ?? 0
  const y = baselineY - height * 0.25

  const bounds: PageRect = {
    x,
    y: Math.max(0, y),
    width,
    height,
  }

  const reliability: TextPositionReliability =
    width > 0 &&
    height > 0 &&
    Number.isFinite(x) &&
    Number.isFinite(baselineY) &&
    fontSizePt > 0
      ? 'high'
      : 'low'

  return { bounds, fontSizePt, reliability }
}

export async function extractPageTextItems(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<ExtractedPdfTextItem[]> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate })
  const textContent = await page.getTextContent()
  const items: ExtractedPdfTextItem[] = []

  for (const raw of textContent.items) {
    if (!isTextItem(raw)) {
      continue
    }
    if (!raw.str.trim()) {
      continue
    }
    const { bounds, fontSizePt, reliability } = computeTextItemGeometry(
      raw,
      viewport.transform,
    )
    items.push({
      id: crypto.randomUUID(),
      pageIndex,
      text: raw.str,
      bounds,
      fontName: raw.fontName ?? 'Unknown',
      fontSizePt,
      positionReliability: reliability,
    })
  }

  return items
}
