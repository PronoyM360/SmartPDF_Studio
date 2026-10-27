import { OPS } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildTextCorrectionOverlays } from '@/features/pdf-editor/textCorrectionOverlays'
import { exportEditedPdf } from '@/lib/pdf/export/exportEditedPdf'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import { resolveReplacementInput } from '@/lib/prices/amountFormat'
import { buildPriceReplacementPlan, estimateBaselineY } from '@/lib/prices/buildPriceReplacementPlan'
import { detectPriceCandidates } from '@/lib/prices/detectPriceCandidates'
import { createPriceSamplePdf } from '@/lib/prices/fixtures/createPriceSamplePdfs'
import { collectTextPaintRuns } from '@/lib/prices/pdfTextStyles'
import { pdfItemsToPriceRuns } from '@/lib/prices/priceTextRuns'
import type { OverlayObject } from '@/types/overlayObjects'
import type { PriceCandidate } from '@/types/priceEditing'

async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return (await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise) as unknown as PDFDocumentProxy
}

function editOverlays(candidate: PriceCandidate, input: string, color: string, letterSpacingPt = 0): OverlayObject[] {
  const resolution = resolveReplacementInput(candidate.amount, input, true)
  const { plan } = buildPriceReplacementPlan({
    candidate,
    replacementText: resolution.text,
    style: {
      fontFamily: 'Arial',
      fontWeight: 'bold',
      fontSizePt: candidate.fontSizePt,
      color,
      maskFillColor: '#ffffff',
      maskOpacity: 1,
      letterSpacingPt,
      alignment: candidate.labelPlacement === 'inline' ? 'left' : 'right',
      backgroundKind: 'solid',
    },
    fidelityStatus: 'approximate_font_match',
    fidelityNotes: [],
    neighbors: [],
  })
  return buildTextCorrectionOverlays({
    ...planToOverlayCorrectionInput({
      pageIndex: candidate.pageIndex,
      originalText: candidate.text,
      replacementText: resolution.text,
      plan,
    }),
    amendment: {
      kind: 'amount',
      targetKey: candidate.id,
      pageIndex: candidate.pageIndex,
      originalText: candidate.text,
      replacementText: resolution.text,
      originalValue: candidate.amount.value,
      replacementValue: resolution.value,
      role: candidate.role,
      label: candidate.label,
      source: candidate.source,
      fontMatch: 'approximate',
      fallbackFontFamily: 'Arial',
      fallbackFontWeight: 'bold',
      baselineY: estimateBaselineY(candidate),
    },
  })
}

describe('exporting edited amounts', async () => {
  const source = await createPriceSamplePdf()
  const original = await open(source)
  const { candidates } = detectPriceCandidates(pdfItemsToPriceRuns(await extractPageTextItems(original, 0)))
  const gross = candidates.find((candidate) => candidate.label === 'Gross Fare')!
  const total = candidates.find((candidate) => candidate.label === 'Total Price')!

  const overlays = [
    ...editOverlays(gross, '5884', '#1a1a1a'),
    ...editOverlays(total, '1234568', '#17a34a', 0.2),
  ]
  const result = await exportEditedPdf({
    source: { name: 'ticket.pdf', byteLength: source.byteLength, originalBytes: source },
    overlays,
    getImageBytes: () => undefined,
    markModifiedPages: false,
  })
  const exported = await open(result.bytes)
  const items = await extractPageTextItems(exported, 0)

  it('labels the copy as modified even when labelling was switched off', async () => {
    expect(result.modifications.amountEdits).toBe(2)
    const notice = items.find((item) => item.text.startsWith('Modified copy'))
    expect(notice?.text).toMatch(/Modified copy — 2 edited amounts/)
    const doc = await PDFDocument.load(result.bytes)
    expect(doc.getKeywords()).toMatch(/Modified copy \(SmartPDF Studio, .*\): 2 edited amounts/)
    expect(result.warnings.join(' ')).toMatch(/Edited amounts always add/)
  })

  it('draws the new values on the original baselines with the original formatting', () => {
    const grossDrawn = items.find((item) => item.text === '5884')!
    expect(grossDrawn).toBeDefined()
    expect(grossDrawn.baseline!.y).toBeCloseTo(gross.baseline!.y, 3)
    expect(grossDrawn.baseline!.x).toBeCloseTo(gross.bounds.x, 3)
    expect(grossDrawn.fontSizePt).toBeCloseTo(12, 3)

    const totalDrawn = items.find((item) => item.text === 'BDT 1,234,568')!
    expect(totalDrawn).toBeDefined()
    expect(totalDrawn.baseline!.y).toBeCloseTo(total.baseline!.y, 3)
    // Right-aligned column: the longer value ends where the original ended.
    const right = totalDrawn.baseline!.x + totalDrawn.advanceWidth!
    expect(right).toBeCloseTo(total.bounds.x + total.bounds.width, 0)
  })

  it('keeps the original document unchanged and other amounts untouched', async () => {
    const originalItems = await extractPageTextItems(await open(source), 0)
    expect(originalItems.some((item) => item.text === 'Gross Fare: 5784')).toBe(true)
    const exportedTexts = items.map((item) => item.text)
    for (const untouched of ['BDT 5,000', 'BDT 584', 'BDT 200', 'BDT 100']) {
      expect(exportedTexts).toContain(untouched)
    }
    expect(exportedTexts.filter((text) => text === 'BDT 5,684')).toHaveLength(2)
  })

  it('exports only committed overlays: no outlines or handles, colours as chosen', async () => {
    const before = await (await original.getPage(1)).getOperatorList()
    const after = await (await exported.getPage(1)).getOperatorList()
    const strokes = (list: { fnArray: ArrayLike<number> }) =>
      Array.from(list.fnArray).filter((fn) => fn === OPS.stroke || fn === OPS.closeStroke).length
    expect(strokes(after)).toBe(strokes(before))
    const paint = collectTextPaintRuns(after, OPS)
    expect(paint.find((run) => run.text === '5884')?.color).toBe('#1a1a1a')
    expect(paint.find((run) => run.text === 'BDT 1,234,568')?.color).toBe('#17a34a')
  })
})
