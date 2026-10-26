import type Tesseract from 'tesseract.js'
import { classifyOcrTextTags } from '@/lib/ocr/classifyOcrText'
import { imageBboxToPdfRect } from '@/lib/ocr/mapImageBboxToPdfRect'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { OcrTextItem } from '@/types/ocr'
import type { PageRect } from '@/types'

function collectWords(page: Tesseract.Page): Tesseract.Word[] {
  const words: Tesseract.Word[] = []
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word.text.trim()) {
            words.push(word)
          }
        }
      }
    }
  }
  return words
}

export function parseOcrPageToItems(
  page: Tesseract.Page,
  pageIndex: number,
  displayTransform: PageDisplayTransform,
  offset: { x: number; y: number },
): OcrTextItem[] {
  const words = collectWords(page)
  return words.map((word) => {
    const bounds = imageBboxToPdfRect(displayTransform, word.bbox, offset)
    const text = word.text.trim()
    return {
      id: crypto.randomUUID(),
      pageIndex,
      text,
      confidence: word.confidence,
      bounds,
      kind: 'word' as const,
      tags: classifyOcrTextTags(text),
    }
  })
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
