import type Tesseract from 'tesseract.js'
import { classifyOcrTextTags } from '@/lib/ocr/classifyOcrText'
import { imageBboxToPdfRect } from '@/lib/ocr/mapImageBboxToPdfRect'
import { estimateGlyphMetrics, harmonizeLineFontSizes } from '@/lib/ocr/ocrTypography'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { OcrTextItem } from '@/types/ocr'
import type { PageRect } from '@/types'

function collectLines(page: Tesseract.Page): Tesseract.Line[] {
  const lines: Tesseract.Line[] = []
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push(line)
      }
    }
  }
  return lines
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function parseOcrPageToItems(
  page: Tesseract.Page,
  pageIndex: number,
  displayTransform: PageDisplayTransform,
  offset: { x: number; y: number },
  options: { includeLines?: boolean } = {},
): OcrTextItem[] {
  const pxPerPt = displayTransform.scale || 1
  const items: OcrTextItem[] = []
  for (const line of collectLines(page)) {
    const words = (line.words ?? []).filter((word) => word.text.trim())
    if (words.length === 0) {
      continue
    }
    const metrics = harmonizeLineFontSizes(
      words.map((word) =>
        estimateGlyphMetrics({
          text: word.text.trim(),
          bbox: word.bbox,
          lineBaseline: line.baseline ?? null,
        }),
      ),
    )
    words.forEach((word, index) => {
      const text = word.text.trim()
      const metric = metrics[index]!
      items.push({
        id: crypto.randomUUID(),
        pageIndex,
        text,
        confidence: word.confidence,
        bounds: imageBboxToPdfRect(displayTransform, word.bbox, offset),
        kind: 'word',
        tags: classifyOcrTextTags(text),
        fontSizePt: round(metric.fontSizePx / pxPerPt),
        baselineFromTopPt: round(metric.baselineFromTopPx / pxPerPt),
      })
    })

    if (options.includeLines && line.text.trim()) {
      const sizes = metrics.map((metric) => metric.fontSizePx).sort((a, b) => a - b)
      const fontSizePx = sizes[Math.floor(sizes.length / 2)] ?? 0
      // Baseline of the line relative to its own box: words share it, so take the median.
      const offsets = words
        .map((word, index) => word.bbox.y0 + metrics[index]!.baselineFromTopPx - line.bbox.y0)
        .sort((a, b) => a - b)
      const baselineFromTopPx = offsets[Math.floor(offsets.length / 2)] ?? fontSizePx * 0.72
      const text = line.text.trim()
      items.push({
        id: crypto.randomUUID(),
        pageIndex,
        text,
        confidence: line.confidence,
        bounds: imageBboxToPdfRect(displayTransform, line.bbox, offset),
        kind: 'line',
        tags: classifyOcrTextTags(text),
        fontSizePt: round(fontSizePx / pxPerPt),
        baselineFromTopPt: round(baselineFromTopPx / pxPerPt),
      })
    }
  }
  return items
}

export function mergeOcrRegionBounds(
  items: readonly OcrTextItem[],
): PageRect | null {
  if (items.length === 0) {
    return null
  }
  const xs = items.map((item) => item.bounds.x)
  const ys = items.map((item) => item.bounds.y)
  const maxX = items.map((item) => item.bounds.x + item.bounds.width)
  const maxY = items.map((item) => item.bounds.y + item.bounds.height)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...maxX) - minX,
    height: Math.max(...maxY) - minY,
  }
}
