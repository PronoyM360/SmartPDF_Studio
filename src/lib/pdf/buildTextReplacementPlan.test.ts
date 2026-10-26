import { describe, expect, it } from 'vitest'
import {
  adjustTextBoundsForReplacement,
  buildTextReplacementPlan,
} from '@/lib/pdf/buildTextReplacementPlan'
import type { ExtractedPdfTextItem } from '@/types/pdfTextInspection'

function item(partial: Partial<ExtractedPdfTextItem>): ExtractedPdfTextItem {
  return {
    id: '1',
    pageIndex: 0,
    text: '5784',
    bounds: { x: 100, y: 200, width: 36, height: 14 },
    fontName: 'Arial-BoldMT',
    fontSizePt: 12,
    positionReliability: 'high',
    ...partial,
  }
}

describe('adjustTextBoundsForReplacement', () => {
  it('widens bounds modestly for longer numeric replacements', () => {
    const bounds = { x: 10, y: 20, width: 40, height: 12 }
    const next = adjustTextBoundsForReplacement(bounds, '5784', '58840')
    expect(next.width).toBeGreaterThan(40)
    expect(next.width).toBeLessThanOrEqual(40 * 1.45)
  })

  it('does not shrink bounds for shorter text', () => {
    const bounds = { x: 10, y: 20, width: 40, height: 12 }
    const next = adjustTextBoundsForReplacement(bounds, '5784', '58')
    expect(next.width).toBe(40)
  })
})

describe('buildTextReplacementPlan', () => {
  it('plans mask and style for a price-like replacement', () => {
    const plan = buildTextReplacementPlan({
      item: item({}),
      replacementText: '5884',
      bounds: item({}).bounds,
      colorSample: {
        backgroundColor: '#ffffff',
        textColor: '#16a34a',
        backgroundKind: 'solid',
        notes: [],
      },
    })
    expect(plan.textBounds.width).toBeGreaterThanOrEqual(36)
    expect(plan.color).toBe('#16a34a')
    expect(plan.fontWeight).toBe('bold')
    expect(plan.fidelityStatus).toBe('original_style_matched')
  })
})
