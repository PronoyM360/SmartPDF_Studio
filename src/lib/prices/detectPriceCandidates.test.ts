import { OPS } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { analyzePageText, MIN_SELECTABLE_TEXT_CHARS } from '@/lib/sections/analyzePageText'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { detectPriceCandidates } from '@/lib/prices/detectPriceCandidates'
import { createPriceSamplePdf } from '@/lib/prices/fixtures/createPriceSamplePdfs'
import {
  assignPaintColors,
  collectTextPaintRuns,
  readPdfFontInfo,
} from '@/lib/prices/pdfTextStyles'
import { ocrItemsToPriceRuns, pdfItemsToPriceRuns } from '@/lib/prices/priceTextRuns'
import type { OcrTextItem } from '@/types/ocr'
import type { PriceCandidate } from '@/types/priceEditing'

async function openFixture(): Promise<PDFDocumentProxy> {
  const data = await createPriceSamplePdf()
  return (await pdfjs.getDocument({ data, verbosity: 0 }).promise) as unknown as PDFDocumentProxy
}

function find(candidates: readonly PriceCandidate[], text: string, label?: string): PriceCandidate {
  const match = candidates.find(
    (candidate) => candidate.text === text && (label === undefined || candidate.label === label),
  )
  expect(match, `${text} ${label ?? ''}`).toBeDefined()
  return match!
}

describe('detectPriceCandidates (real pdf.js)', async () => {
  const pdf = await openFixture()
  const pageRuns = async (pageIndex: number) => pdfItemsToPriceRuns(await extractPageTextItems(pdf, pageIndex))
  const ticket = detectPriceCandidates(await pageRuns(0))
  const invoice = detectPriceCandidates(await pageRuns(1))

  it('finds labelled ticket amounts with roles and labels', () => {
    const summary = ticket.candidates.map((candidate) => [candidate.text, candidate.role, candidate.label])
    expect(summary).toEqual([
      ['BDT 5,000', 'base_fare', 'Base Fare'],
      ['BDT 584', 'tax', 'Tax'],
      ['BDT 200', 'service_charge', 'Service Charge'],
      ['5784', 'gross_fare', 'Gross Fare'],
      ['BDT 100', 'discount', 'Discount'],
      ['BDT 5,684', 'total', 'Total Price'],
      ['BDT 5,684', 'amount_paid', 'Amount Paid'],
    ])
    expect(ticket.candidates.every((candidate) => candidate.confidence === 'high')).toBe(true)
  })

  it('does not treat flight numbers, dates, times, ticket numbers or references as prices', () => {
    const texts = ticket.candidates.map((candidate) => candidate.text)
    for (const notPrice of ['147', '2026', '10:30', '20', '2401234567', '997', '12']) {
      expect(texts).not.toContain(notPrice)
    }
    const reasons = ticket.rejected.map((entry) => `${entry.text} → ${entry.reason}`)
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^997 2401234567 → Ticket number/),
        expect.stringMatching(/^12 JAN 2026 → Date/),
        expect.stringMatching(/^10:30 → Time/),
        expect.stringMatching(/^\+880 1700 000000 → Phone number/),
        expect.stringMatching(/^147 → .*(identifier|flight number)/i),
        expect.stringMatching(/^20 → Quantity or measure/),
        expect.stringMatching(/^12 → Digits are joined to letters/),
      ]),
    )
  })

  it('selects only the amount inside an inline label run ("Gross Fare: 5784")', () => {
    const gross = find(ticket.candidates, '5784')
    expect(gross.runText).toBe('Gross Fare: 5784')
    expect(gross.labelPlacement).toBe('inline')
    const run = ticket.candidates.find((candidate) => candidate.runId === gross.runId)!
    expect(gross.bounds.x).toBeGreaterThan(40 + 30)
    expect(gross.bounds.width).toBeLessThan(run.bounds.width + 1)
    expect(gross.baseline?.y).toBeCloseTo(792 - 266, 3)
    expect(gross.fontSizePt).toBeCloseTo(12, 3)
  })

  it('handles table columns, decimals, currencies and duplicates on the invoice', () => {
    const roles = invoice.candidates.map((candidate) => `${candidate.text}:${candidate.role}`)
    expect(roles).toEqual(
      expect.arrayContaining([
        '$1,234.56:base_fare',
        '$65.44:tax',
        '$1,300.00:total',
        '$2,600.00:subtotal',
        '($100.00):discount',
        '$2,500.00:total',
        '£12.50:surcharge',
        '2.300,50 €:amount_paid',
      ]),
    )
    const base = invoice.candidates.filter((candidate) => candidate.text === '$1,234.56')
    expect(base).toHaveLength(2)
    expect(base.every((candidate) => candidate.labelPlacement === 'above')).toBe(true)
    expect(base.every((candidate) => candidate.duplicateCount === 2)).toBe(true)
    expect(new Set(base.map((candidate) => candidate.id)).size).toBe(2)
    expect(find(invoice.candidates, '($100.00)').amount.value).toBe(-100)
  })

  it('ignores identifiers, dates and percentages on the invoice', () => {
    const texts = invoice.candidates.map((candidate) => candidate.text)
    for (const notPrice of ['5784', '2026-0042', '123456789', '10', '2026-01-12']) {
      expect(texts).not.toContain(notPrice)
    }
    expect(invoice.rejected.some((entry) => entry.reason === 'Percentage, not an amount')).toBe(true)
  })

  it('flags rotated amounts as not replaceable', () => {
    const rotated = find(invoice.candidates, 'USD 99.00')
    expect(rotated.editable).toBe(false)
    expect(rotated.blockedReason).toMatch(/Rotated/)
  })

  it('reads exact fill colours and font flags from the content stream', async () => {
    const page = await pdf.getPage(1)
    const operatorList = await page.getOperatorList()
    const paintRuns = collectTextPaintRuns(operatorList, OPS)
    const colors = assignPaintColors(ticket.candidates, paintRuns)
    const total = find(ticket.candidates, 'BDT 5,684', 'Total Price')
    const paid = find(ticket.candidates, 'BDT 5,684', 'Amount Paid')
    expect(colors.get(total.id)).toBe('#17a34a')
    expect(colors.get(paid.id)).toBe('#1a1a1a')
    expect(colors.get(find(ticket.candidates, '5784').id)).toBe('#1a1a1a')

    const totalFont = readPdfFontInfo(page.commonObjs, total.fontName)
    const paidFont = readPdfFontInfo(page.commonObjs, paid.fontName)
    expect(totalFont).toMatchObject({ bold: true, embedded: false, genericFamily: 'sans-serif' })
    expect(paidFont).toMatchObject({ bold: false, embedded: false })
  })

  it('reports image-only pages as needing OCR', async () => {
    const analysis = await analyzePageText(pdf, 2)
    expect(analysis.textCharCount).toBeLessThan(MIN_SELECTABLE_TEXT_CHARS)
    expect(analysis.hasImages).toBe(true)
    expect(detectPriceCandidates(await pageRuns(2)).candidates).toEqual([])
  })
})

describe('image-based prices (OCR words)', () => {
  const word = (id: string, text: string, x: number, confidence: number, y = 500): OcrTextItem => ({
    id,
    pageIndex: 2,
    text,
    confidence,
    bounds: { x, y, width: text.length * 6, height: 9 },
    kind: 'word',
    tags: [],
  })

  it('detects amounts from OCR words with their confidence', () => {
    const runs = ocrItemsToPriceRuns(
      [
        word('a', 'Total', 40, 95),
        word('b', 'Amount:', 75, 93),
        word('c', 'Tk.5,784', 130, 71),
        word('d', 'Flight', 40, 96, 470),
        word('e', 'BG', 80, 96, 470),
        word('f', '147', 98, 96, 470),
      ],
      [],
    )
    const { candidates } = detectPriceCandidates(runs)
    expect(candidates).toHaveLength(1)
    const [total] = candidates
    expect(total).toMatchObject({ text: 'Tk.5,784', role: 'total', source: 'ocr', ocrConfidence: 71, confidence: 'medium' })
    expect(total!.label).toBe('Total Amount')
    expect(total!.reasons.join(' ')).toMatch(/OCR confidence 71%/)
  })

  it('treats a separately recognised currency word as part of the amount, not its label', () => {
    const runs = ocrItemsToPriceRuns(
      [
        word('a', 'Base', 40, 95),
        word('b', 'Fare', 70, 95),
        word('c', 'USD', 420, 94),
        word('d', '120.00', 442, 96),
        word('i', 'Taxes', 40, 95, 485),
        word('j', '&', 76, 90, 485),
        word('k', 'Surcharges', 86, 95, 485),
        word('l', 'USD', 420, 94, 485),
        word('m', '35.50', 442, 96, 485),
        word('e', 'Total', 40, 95, 470),
        word('f', 'Price', 72, 95, 470),
        word('g', 'USD', 420, 94, 470),
        word('h', '155.50', 442, 92, 470),
      ],
      [],
    )
    const { candidates } = detectPriceCandidates(runs)
    expect(candidates.map((candidate) => [candidate.text, candidate.role, candidate.label])).toEqual([
      ['120.00', 'base_fare', 'Base Fare'],
      ['35.50', 'tax', 'Taxes & Surcharges'],
      ['155.50', 'total', 'Total Price'],
    ])
    expect(candidates[0]!.reasons.join(' ')).toMatch(/Currency “USD” printed just before the number/)
    // OCR positions are estimates, which caps confidence below "high".
    expect(candidates[0]!.confidence).toBe('medium')
  })

  it('skips OCR words that duplicate selectable text', () => {
    const runs = ocrItemsToPriceRuns([word('a', '5784', 100, 90)], [
      { bounds: { x: 99, y: 499, width: 30, height: 11 } },
    ])
    expect(runs).toEqual([])
  })
})
