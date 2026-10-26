import { describe, expect, it } from 'vitest'
import { searchExtractedTextItems } from '@/features/text-tools/searchPdfText'
import type { ExtractedPdfTextItem } from '@/types/pdfTextInspection'

const bounds = { x: 10, y: 20, width: 100, height: 12 }

function item(
  id: string,
  pageIndex: number,
  text: string,
): ExtractedPdfTextItem {
  return {
    id,
    pageIndex,
    text,
    bounds,
    fontName: 'Helvetica',
    fontSizePt: 12,
    positionReliability: 'high',
  }
}

describe('searchExtractedTextItems', () => {
  it('returns no results for empty query', () => {
    expect(searchExtractedTextItems([item('a', 0, 'hello')], '   ')).toEqual([])
  })

  it('finds repeated values in one item', () => {
    const results = searchExtractedTextItems([item('a', 0, 'foo bar foo')], 'foo')
    expect(results).toHaveLength(2)
    expect(results[0]?.matchStartIndex).toBe(0)
    expect(results[1]?.matchStartIndex).toBe(8)
    expect(results[0]?.matchBounds.x).toBeLessThan(results[1]?.matchBounds.x ?? 0)
  })

  it('finds partial matches within longer text', () => {
    const results = searchExtractedTextItems(
      [item('a', 0, 'Price: $10 each')],
      '$10',
    )
    expect(results).toHaveLength(1)
    expect(results[0]?.matchText).toBe('$10')
    expect(results[0]?.matchBounds.width).toBeLessThan(bounds.width)
  })

  it('searches across multiple pages via item list', () => {
    const results = searchExtractedTextItems(
      [item('a', 0, 'alpha'), item('b', 2, 'beta alpha')],
      'alpha',
    )
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.pageIndex)).toEqual([0, 2])
  })

  it('is case-insensitive', () => {
    const results = searchExtractedTextItems([item('a', 0, 'Hello World')], 'world')
    expect(results[0]?.matchText).toBe('World')
  })

  it('marks matches as selectable PDF text', () => {
    const results = searchExtractedTextItems([item('a', 0, 'x')], 'x')
    expect(results[0]?.textSource).toBe('pdf_selectable')
  })
})
