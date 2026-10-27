import { describe, expect, it } from 'vitest'
import { parseAmount } from '@/lib/prices/amountFormat'
import {
  buildPriceReplacementPlan,
  inferPriceAlignment,
  type PriceStyleChoice,
  type PriceTextMetrics,
} from '@/lib/prices/buildPriceReplacementPlan'
import type { PriceCandidate } from '@/types/priceEditing'

function candidate(overrides: Partial<PriceCandidate> & { text: string; x: number; width: number }): PriceCandidate {
  const { text, x, width, ...rest } = overrides
  return {
    id: `c-${text}-${x}`,
    pageIndex: 0,
    source: 'pdf_text',
    runId: `r-${text}-${x}`,
    runText: text,
    startIndex: 0,
    endIndex: text.length,
    text,
    amount: parseAmount(text)!,
    bounds: { x, y: 497.5, width, height: 10.5 },
    baseline: { x, y: 500 },
    role: 'other',
    label: null,
    labelPlacement: 'left',
    confidence: 'high',
    reasons: [],
    fontName: 'g_d0_f1',
    fontSizePt: 10,
    ocrConfidence: null,
    duplicateCount: 1,
    editable: true,
    blockedReason: null,
    ...rest,
  }
}

const style = (overrides: Partial<PriceStyleChoice> = {}): PriceStyleChoice => ({
  fontFamily: 'Arial',
  fontWeight: 'normal',
  fontSizePt: 10,
  color: '#17a34a',
  maskFillColor: '#ffffff',
  maskOpacity: 1,
  letterSpacingPt: 0,
  alignment: 'left',
  backgroundKind: 'solid',
  ...overrides,
})

/** 0.556 em per character (Helvetica digit width), baseline 0.8 em below the box top. */
const metrics: PriceTextMetrics = {
  measureWidth: (text, _family, _weight, size, spacing) => text.length * (size * 0.556 + spacing),
  baselineFromTop: (_family, _weight, size) => size * 0.8,
}

describe('buildPriceReplacementPlan', () => {
  it('keeps the original baseline, size and colour', () => {
    const original = candidate({ text: '5784', x: 100, width: 22.24 })
    const { plan } = buildPriceReplacementPlan({
      candidate: original,
      replacementText: '5884',
      style: style(),
      fidelityStatus: 'approximate_font_match',
      fidelityNotes: [],
      neighbors: [],
      metrics,
    })
    const top = plan.textBounds.y + plan.textBounds.height
    expect(top - 10 * 0.8).toBeCloseTo(500, 6)
    expect(plan.textBounds.x).toBe(100)
    expect(plan.fontSize).toBe(10)
    expect(plan.color).toBe('#17a34a')
    expect(plan.maskBounds.x).toBeLessThan(original.bounds.x)
    expect(plan.maskBounds.x + plan.maskBounds.width).toBeGreaterThan(original.bounds.x + original.bounds.width)
  })

  it('grows right-aligned amounts to the left and keeps the right edge', () => {
    const original = candidate({ text: 'BDT 5,784', x: 500, width: 50 })
    const { plan, warnings } = buildPriceReplacementPlan({
      candidate: original,
      replacementText: 'BDT 1,234,567.00',
      style: style({ alignment: 'right' }),
      fidelityStatus: 'approximate_font_match',
      fidelityNotes: [],
      neighbors: [{ text: 'Gross Fare', bounds: { x: 420, y: 497.5, width: 45, height: 10.5 } }],
      metrics,
    })
    expect(plan.alignment).toBe('right')
    expect(plan.textBounds.x + plan.textBounds.width).toBeCloseTo(550, 6)
    expect(plan.textBounds.x).toBeLessThan(500)
    expect(warnings.join(' ')).toMatch(/wider than the original/)
    expect(warnings.join(' ')).toMatch(/overlap nearby text “Gross Fare”/)
  })

  it('covers the full original when the replacement is shorter', () => {
    const original = candidate({ text: '$1,300.00', x: 300, width: 45 })
    const { plan } = buildPriceReplacementPlan({
      candidate: original,
      replacementText: '$99.00',
      style: style({ alignment: 'right' }),
      fidelityStatus: 'approximate_font_match',
      fidelityNotes: [],
      neighbors: [],
      metrics,
    })
    expect(plan.maskBounds.x).toBeLessThanOrEqual(300)
    expect(plan.maskBounds.x + plan.maskBounds.width).toBeGreaterThanOrEqual(345)
  })

  it('places OCR amounts on the bottom of the recognised box', () => {
    const ocr = candidate({ text: '5784', x: 100, width: 22, source: 'ocr', baseline: null })
    const { plan } = buildPriceReplacementPlan({
      candidate: ocr,
      replacementText: '5884',
      style: style(),
      fidelityStatus: 'ocr_assisted',
      fidelityNotes: [],
      neighbors: [],
      metrics,
    })
    expect(plan.textBounds.y + plan.textBounds.height - 8).toBeCloseTo(ocr.bounds.y, 6)
  })
})

describe('inferPriceAlignment', () => {
  it('detects a right-aligned column', () => {
    const a = candidate({ text: 'BDT 5,000', x: 510, width: 50 })
    const b = candidate({ text: 'BDT 584', x: 520, width: 40, bounds: { x: 520, y: 480, width: 40, height: 10.5 } })
    expect(inferPriceAlignment(a, [a, b]).alignment).toBe('right')
  })

  it('defaults to keeping the left edge', () => {
    const a = candidate({ text: '5784', x: 100, width: 22, labelPlacement: 'inline' })
    expect(inferPriceAlignment(a, [a]).alignment).toBe('left')
  })
})
