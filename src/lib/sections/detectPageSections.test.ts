import { describe, expect, it } from 'vitest'
import { buildManualSection } from '@/lib/sections/buildManualSection'
import { matchSectionLabel } from '@/lib/sections/classifySectionText'
import { detectPageSections } from '@/lib/sections/detectPageSections'
import type { PageRect } from '@/types'
import type { SectionTextRun } from '@/types/documentSections'

const PAGE_W = 612
const PAGE_H = 792

/** Unrotated page: display space is PDF space flipped vertically. */
const toDisplayRect = (rect: PageRect): PageRect => ({
  x: rect.x,
  y: PAGE_H - rect.y - rect.height,
  width: rect.width,
  height: rect.height,
})
const toPdfRect = toDisplayRect

/** Place text by its top-left display position (easier to read than PDF coordinates). */
function run(text: string, left: number, top: number, size = 10, confidence: number | null = null): SectionTextRun {
  const width = text.length * size * 0.5
  const height = size * 1.05
  return {
    text,
    bounds: { x: left, y: PAGE_H - top - height, width, height },
    fontSizePt: size,
    confidence,
  }
}

function detect(runs: SectionTextRun[], textSource: 'pdf_text' | 'ocr' = 'pdf_text') {
  return detectPageSections({
    pageIndex: 0,
    runs,
    textSource,
    toDisplayRect,
    toPdfRect,
    displayWidth: PAGE_W,
    displayHeight: PAGE_H,
  })
}

const ticketRuns: SectionTextRun[] = [
  run('ELECTRONIC TICKET RECEIPT', 40, 30, 18),
  // two-column header area
  run('PASSENGER INFORMATION', 40, 80, 11),
  run('Name: MR JOHN DOE', 40, 96),
  run('Passport: X1234567', 40, 110),
  run('BOOKING DETAILS', 340, 80, 11),
  run('PNR: AB12CD', 340, 96),
  run('Issued: 12 JAN 2026', 340, 110),
  // flight table separated by a bigger gap from its heading
  run('FLIGHT DETAILS', 40, 160, 11),
  run('BG 147', 40, 190),
  run('DAC 10:30', 160, 190),
  run('CXB 11:35', 300, 190),
  run('Economy', 440, 190),
  // fare lines with value columns
  run('Base Fare', 40, 260),
  run('USD 120.00', 420, 260),
  run('Taxes & Surcharges', 40, 274),
  run('USD 35.50', 420, 274),
  run('Total Price', 40, 288, 11),
  run('USD 155.50', 420, 288, 11),
  run('BAGGAGE ALLOWANCE', 40, 340, 11),
  run('Checked: 20 KG', 40, 356),
  run('Cabin: 7 KG', 40, 370),
  run('TERMS AND CONDITIONS', 40, 430, 11),
  run('Tickets are non-refundable after departure and subject to fare rules.', 40, 446, 9),
  run('Changes must be made 24 hours before departure.', 40, 458, 9),
]

describe('matchSectionLabel', () => {
  it('maps common label variations to categories', () => {
    expect(matchSectionLabel('Traveller Details')?.category).toBe('passenger')
    expect(matchSectionLabel('PNR')?.category).toBe('booking')
    expect(matchSectionLabel('Taxes & Fees')?.category).toBe('tax')
    expect(matchSectionLabel('Grand Total')?.category).toBe('total')
    expect(matchSectionLabel('Fare Rules')?.category).toBe('terms')
    expect(matchSectionLabel('Luggage allowance')?.category).toBe('baggage')
    expect(matchSectionLabel('Tax Invoice')?.category).toBe('booking')
  })

  it('flags ambiguous labels instead of guessing silently', () => {
    const totalFare = matchSectionLabel('Total Fare')
    expect(totalFare?.category).toBe('gross_fare')
    expect(totalFare?.ambiguous).toBe(true)
    expect(totalFare?.alternatives).toContain('total')

    const fare = matchSectionLabel('Fare')
    expect(fare?.ambiguous).toBe(true)
  })

  it('returns null for text without a known label', () => {
    expect(matchSectionLabel('MR JOHN DOE')).toBeNull()
  })
})

describe('detectPageSections', () => {
  const sections = detect(ticketRuns)
  const byCategory = (category: string) => sections.filter((section) => section.category === category)

  it('finds headed sections in a two-column ticket layout', () => {
    const passenger = byCategory('passenger')
    expect(passenger).toHaveLength(1)
    expect(passenger[0]?.text).toContain('MR JOHN DOE')
    expect(passenger[0]?.text).not.toContain('PNR')
    expect(passenger[0]?.confidence).toBe('high')

    const booking = byCategory('booking')
    expect(booking).toHaveLength(1)
    expect(booking[0]?.text).toContain('PNR: AB12CD')
    expect(booking[0]?.text).toContain('Issued')
  })

  it('attaches a table below a standalone heading', () => {
    const flight = byCategory('flight')
    expect(flight).toHaveLength(1)
    expect(flight[0]?.text).toContain('BG 147')
    expect(flight[0]?.text).toContain('CXB 11:35')
    expect(flight[0]?.text).toContain('Economy')
  })

  it('creates separate fare, tax and total sections including their amounts', () => {
    expect(byCategory('base_fare')[0]?.text).toContain('USD 120.00')
    expect(byCategory('tax')[0]?.text).toContain('USD 35.50')
    const total = byCategory('total')[0]
    expect(total?.text).toContain('USD 155.50')
    expect(total?.confidence).toBe('high')
    // Value cells are not repeated as stray text blocks.
    expect(sections.some((section) => section.category === 'other' && /USD/.test(section.text))).toBe(false)
  })

  it('detects baggage and terms blocks', () => {
    expect(byCategory('baggage')[0]?.text).toContain('20 KG')
    expect(byCategory('terms')[0]?.text).toContain('non-refundable')
  })

  it('returns bounds in PDF space that contain the source text', () => {
    const total = byCategory('total')[0]!
    const label = ticketRuns.find((entry) => entry.text === 'Total Price')!
    expect(total.bounds.x).toBeLessThanOrEqual(label.bounds.x)
    expect(total.bounds.y).toBeLessThanOrEqual(label.bounds.y)
    expect(total.bounds.y + total.bounds.height).toBeGreaterThanOrEqual(label.bounds.y + label.bounds.height)
  })

  it('produces stable IDs across runs', () => {
    const again = detect(ticketRuns)
    expect(again.map((section) => section.id)).toEqual(sections.map((section) => section.id))
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length)
  })

  it('handles invoices with different label wording', () => {
    const invoice = detect([
      run('Bill To:', 40, 60, 11),
      run('ACME Corp, 1 Main St', 40, 76),
      run('billing@acme.example', 40, 90),
      run('Subtotal', 300, 300),
      run('$ 900.00', 480, 300),
      run('VAT', 300, 314),
      run('$ 90.00', 480, 314),
      run('Amount Due', 300, 328),
      run('$ 990.00', 480, 328),
    ])
    expect(invoice.find((section) => section.category === 'contact')?.text).toContain('ACME')
    const subtotal = invoice.find((section) => section.category === 'base_fare')
    expect(subtotal?.ambiguous).toBe(true)
    expect(invoice.find((section) => section.category === 'tax')?.text).toContain('90.00')
    expect(invoice.find((section) => section.category === 'total')?.text).toContain('990.00')
  })

  it('does not invent categories for documents without recognizable headings', () => {
    const plain = detect([
      run('The quarterly garden club meeting will take place in the hall.', 40, 60),
      run('Bring seeds for the exchange table and a packed lunch.', 40, 74),
      run('Weather permitting we will walk the north meadow afterwards.', 40, 160),
    ])
    expect(plain.length).toBeGreaterThan(0)
    expect(plain.every((section) => section.category === 'other')).toBe(true)
    expect(plain.every((section) => section.evidence === 'layout')).toBe(true)
  })

  it('returns nothing for a page with no text', () => {
    expect(detect([])).toEqual([])
  })

  it('caps OCR-derived confidence and flags low OCR confidence', () => {
    const ocr = detect(
      [
        run('PASSENGER', 40, 80, 11, 92),
        run('DETAILS', 120, 80, 11, 90),
        run('MR', 40, 96, 10, 40),
        run('JOHN', 60, 96, 10, 45),
      ],
      'ocr',
    )
    const passenger = ocr.find((section) => section.category === 'passenger')
    expect(passenger?.textSource).toBe('ocr')
    expect(passenger?.confidence).not.toBe('high')
    expect(passenger?.ocrConfidence).not.toBeNull()
  })

  it('does not treat taller OCR words (descenders) as size-based headings', () => {
    // Heights mirror real Tesseract boxes: "Economy" is ~1.26× taller than caps/digits.
    const ocrWord = (text: string, left: number, top: number, height: number): SectionTextRun => ({
      text,
      bounds: { x: left, y: PAGE_H - top - height, width: text.length * 5, height },
      fontSizePt: null,
      confidence: 95,
    })
    const ocr = detect(
      [
        ocrWord('FLIGHT', 40, 190, 8),
        ocrWord('DETAILS', 82, 190, 8),
        ocrWord('BG', 40, 220, 7.6),
        ocrWord('147', 55, 220, 7.6),
        ocrWord('DAC', 160, 220, 7.6),
        ocrWord('10:30', 182, 220, 7.6),
        ocrWord('Economy', 440, 220, 9.6),
      ],
      'ocr',
    )
    expect(ocr).toHaveLength(1)
    expect(ocr[0]?.category).toBe('flight')
    expect(ocr[0]?.text).toContain('Economy')
  })

  it('works on a 90° rotated page via the display transform', () => {
    // Rotation 90: display (x, y) = (pdfY, pdfX) with display width = PDF height.
    const rotToDisplay = (rect: PageRect): PageRect => ({
      x: rect.y,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    })
    const rotated = detectPageSections({
      pageIndex: 2,
      runs: ticketRuns.map((entry) => ({ ...entry, bounds: rotToDisplay(toDisplayRect(entry.bounds)) })),
      textSource: 'pdf_text',
      toDisplayRect: rotToDisplay,
      toPdfRect: rotToDisplay,
      displayWidth: PAGE_W,
      displayHeight: PAGE_H,
    })
    expect(rotated.map((section) => section.category).sort()).toEqual(
      sections.map((section) => section.category).sort(),
    )
    expect(rotated.every((section) => section.pageIndex === 2)).toBe(true)
  })
})

describe('buildManualSection', () => {
  it('classifies text inside a drawn region as a suggestion', () => {
    const regionRuns = ticketRuns.filter((entry) => /BAGGAGE|KG/.test(entry.text))
    const section = buildManualSection({
      id: 'manual-1',
      pageIndex: 0,
      bounds: { x: 30, y: 400, width: 200, height: 70 },
      runs: regionRuns,
      textSource: 'pdf_text',
      toDisplayRect,
      ordinal: 1,
    })
    expect(section.origin).toBe('manual')
    expect(section.category).toBe('baggage')
    expect(section.confidence).not.toBe('high')
  })

  it('marks regions without text as having no text source', () => {
    const section = buildManualSection({
      id: 'manual-2',
      pageIndex: 0,
      bounds: { x: 0, y: 0, width: 50, height: 50 },
      runs: [],
      textSource: 'pdf_text',
      toDisplayRect,
      ordinal: 2,
    })
    expect(section.textSource).toBe('none')
    expect(section.category).toBe('other')
    expect(section.suggestedLabel).toBe('Region 2')
  })
})
