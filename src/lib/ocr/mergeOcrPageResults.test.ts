import { describe, expect, it } from 'vitest'
import { mergeOcrPageResults } from '@/lib/ocr/mergeOcrPageResults'
import type { OcrPageResult, OcrTextItem } from '@/types/ocr'

function item(id: string, bounds: OcrTextItem['bounds'], text: string): OcrTextItem {
  return {
    id,
    pageIndex: 0,
    text,
    confidence: 80,
    bounds,
    kind: 'word',
    tags: [],
  }
}

const baseResult = (items: OcrTextItem[], regionBounds: OcrPageResult['regionBounds']): OcrPageResult => ({
  pageIndex: 0,
  languageId: 'eng',
  items,
  ranAt: 1,
  regionBounds,
})

describe('mergeOcrPageResults', () => {
  it('replaces entire page on full-page OCR', () => {
    const existing = baseResult([item('a', { x: 0, y: 0, width: 10, height: 10 }, 'old')], null)
    const incoming = baseResult([item('b', { x: 50, y: 0, width: 10, height: 10 }, 'new')], null)
    const merged = mergeOcrPageResults(existing, incoming)
    expect(merged.items.map((entry) => entry.id)).toEqual(['b'])
  })

  it('keeps items outside a region OCR crop', () => {
    const region = { x: 100, y: 100, width: 80, height: 30 }
    const existing = baseResult(
      [
        item('keep', { x: 10, y: 10, width: 40, height: 12 }, 'left'),
        item('drop', { x: 110, y: 105, width: 30, height: 12 }, 'inside'),
      ],
      null,
    )
    const incoming = baseResult(
      [item('new', { x: 112, y: 106, width: 28, height: 12 }, '$9.99')],
      region,
    )
    const merged = mergeOcrPageResults(existing, incoming)
    expect(merged.items.map((entry) => entry.id).sort()).toEqual(['keep', 'new'])
  })
})
