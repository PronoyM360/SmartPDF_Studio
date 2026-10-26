import { describe, expect, it } from 'vitest'
import { assessReplaceAllReliability } from '@/features/text-tools/assessReplaceAllReliability'
import type { PdfTextSearchResult } from '@/types/pdfTextInspection'

const baseResult: PdfTextSearchResult = {
  id: '1-0',
  pageIndex: 0,
  itemId: '1',
  matchText: 'a',
  matchStartIndex: 0,
  matchEndIndex: 1,
  matchBounds: { x: 0, y: 0, width: 10, height: 10 },
  context: 'a',
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  positionReliability: 'high',
  textSource: 'pdf_selectable',
}

describe('assessReplaceAllReliability', () => {
  it('rejects empty replacement', () => {
    const result = assessReplaceAllReliability([baseResult], '  ')
    expect(result.reliable).toBe(false)
  })

  it('allows distinct items across pages', () => {
    const results = [
      baseResult,
      { ...baseResult, id: '2-0', itemId: '2', pageIndex: 1 },
    ]
    expect(assessReplaceAllReliability(results, 'b').reliable).toBe(true)
  })

  it('blocks multiple matches on the same PDF text item', () => {
    const results = [
      baseResult,
      { ...baseResult, id: '1-1', matchStartIndex: 1, matchEndIndex: 2 },
    ]
    expect(assessReplaceAllReliability(results, 'b').reliable).toBe(false)
  })

  it('blocks low position confidence', () => {
    const results = [{ ...baseResult, positionReliability: 'low' as const }]
    expect(assessReplaceAllReliability(results, 'b').reliable).toBe(false)
  })

  it('blocks OCR-sourced matches', () => {
    const results = [{ ...baseResult, textSource: 'ocr' as const }]
    expect(assessReplaceAllReliability(results, 'b').reliable).toBe(false)
  })
})
