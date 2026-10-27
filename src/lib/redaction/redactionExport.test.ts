import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { exportEditedPdf } from '@/lib/pdf/export/exportEditedPdf'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { flattenPagesToImages, pruneUnreachableObjects } from '@/lib/redaction/flattenPages'
import { scanPdfForText } from '@/lib/redaction/scanPdfForText'
import type { OpenPdfInspector } from '@/lib/redaction/types'
import {
  collectRedactionNeedles,
  verifyRedactedExport,
} from '@/lib/redaction/verifyRedactedExport'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'

const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
)

const EMAIL = 'support@skyline.example'
const PHONE = '+880 1700 000000'

async function openPdfJs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return (await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise) as unknown as PDFDocumentProxy
}

/** Node stand-in for the browser inspector: real PDF.js text layer, placeholder raster. */
const openNodeInspector: OpenPdfInspector = async (bytes) => {
  const pdf = await openPdfJs(bytes)
  return {
    pageCount: pdf.numPages,
    readPageText: async (pageIndex) =>
      (await extractPageTextItems(pdf, pageIndex)).map((item) => ({
        text: item.text,
        bounds: item.bounds,
      })),
    rasterizeWithRedactions: async (pageIndex) => {
      const page = await pdf.getPage(pageIndex + 1)
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
      return { png: PNG_1PX, visibleBox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }
    },
    measureFillCoverage: async () => null,
    destroy: () => pdf.loadingTask.destroy(),
  }
}

async function buildSource(options: { withForm?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page1 = doc.addPage([612, 792])
  page1.drawText('CONTACT INFORMATION', { x: 40, y: 700, size: 12, font })
  page1.drawText(EMAIL, { x: 40, y: 684, size: 10, font })
  page1.drawText(PHONE, { x: 40, y: 670, size: 10, font })
  page1.drawText('FLIGHT DETAILS BG 147', { x: 40, y: 500, size: 10, font })
  if (options.withForm) {
    const field = doc.getForm().createTextField('contact.email')
    field.setText('private.person@example.org')
    field.addToPage(page1, { x: 300, y: 680, width: 200, height: 20 })
  }
  const page2 = doc.addPage([612, 792])
  page2.setRotation(degrees(90))
  page2.drawText('Terms and conditions apply.', { x: 40, y: 700, size: 10, font })
  return doc.save()
}

function mask(partial: Partial<MaskOverlayObject> & Pick<MaskOverlayObject, 'bounds'>): MaskOverlayObject {
  return {
    id: crypto.randomUUID(),
    kind: 'mask',
    pageIndex: 0,
    fillColor: '#000000',
    opacity: 1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const CONTACT_AREA = { x: 30, y: 660, width: 300, height: 60 }

async function exportWith(overlays: OverlayObject[], sourceBytes: Uint8Array, markModifiedPages = false) {
  return exportEditedPdf({
    source: { name: 'ticket.pdf', byteLength: sourceBytes.byteLength, originalBytes: sourceBytes },
    overlays,
    getImageBytes: () => undefined,
    openInspector: openNodeInspector,
    markModifiedPages,
  })
}

async function pageText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const pdf = await openPdfJs(bytes)
  const items = await extractPageTextItems(pdf, pageIndex)
  await pdf.loadingTask.destroy()
  return items.map((item) => item.text).join(' ')
}

describe('secure redaction export', () => {
  it('removes redacted text from the file and verifies it', async () => {
    const source = await buildSource()
    const result = await exportWith([mask({ bounds: CONTACT_AREA, mode: 'redact', label: 'Contact' })], source)

    expect(result.verification.ok).toBe(true)
    expect(result.redaction?.ok).toBe(true)
    expect(result.redaction?.checkedNeedleCount).toBeGreaterThan(0)
    expect(result.redaction?.pagesWithTextLayer).toEqual([])
    expect(await pageText(result.bytes, 0)).toBe('')
    expect(await scanPdfForText(result.bytes, [EMAIL, PHONE])).toEqual([])
    // Unredacted page keeps its selectable text, size and rotation.
    expect(await pageText(result.bytes, 1)).toContain('Terms and conditions')
    const reopened = await PDFDocument.load(result.bytes)
    expect(reopened.getPage(1).getRotation().angle).toBe(90)
    expect(reopened.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  })

  it('passes verification when the redacted page also carries the modified-copy notice', async () => {
    const source = await buildSource()
    const result = await exportWith([mask({ bounds: CONTACT_AREA, mode: 'redact' })], source, true)
    expect(await pageText(result.bytes, 0)).toContain('Modified copy')
    expect(result.redaction?.ok).toBe(true)
  })

  it('fails verification for a file that was not actually redacted', async () => {
    const source = await buildSource()
    const verification = await verifyRedactedExport({
      exportedBytes: source,
      pages: [{ pageIndex: 0, areas: [{ bounds: CONTACT_AREA, fillColor: '#000000' }], needles: [EMAIL] }],
      openInspector: openNodeInspector,
    })
    expect(verification.ok).toBe(false)
    expect(verification.pagesWithTextLayer).toEqual([0])
    expect(verification.hiddenLeaks.map((leak) => leak.needle)).toContain(EMAIL)
  })

  it('does not search number-only strings, which match drawing operands', () => {
    const needles = collectRedactionNeedles(
      [{ text: 'Phone: +880 1700 000000', bounds: { x: 40, y: 670, width: 120, height: 10 } }],
      [{ bounds: CONTACT_AREA, fillColor: '#000000' }],
    )
    expect(needles).toContain('Phone: +880 1700 000000')
    expect(needles).not.toContain('000000')
    expect(needles).not.toContain('1700')
  })

  it('would leak the old content stream without pruning (control)', async () => {
    const source = await buildSource()
    const doc = await PDFDocument.load(source)
    await flattenPagesToImages(doc, [
      { pageIndex: 0, png: PNG_1PX, visibleBox: { x: 0, y: 0, width: 612, height: 792 } },
    ])
    const unpruned = await doc.save()
    expect((await scanPdfForText(unpruned, [EMAIL])).length).toBeGreaterThan(0)

    const pruned = await PDFDocument.load(source)
    await flattenPagesToImages(pruned, [
      { pageIndex: 0, png: PNG_1PX, visibleBox: { x: 0, y: 0, width: 612, height: 792 } },
    ])
    pruneUnreachableObjects(pruned)
    expect(await scanPdfForText(await pruned.save(), [EMAIL])).toEqual([])
  })

  it('removes form field values whose widgets were on the redacted page', async () => {
    const source = await buildSource({ withForm: true })
    expect((await scanPdfForText(source, ['private.person@example.org'])).length).toBeGreaterThan(0)
    const result = await exportWith([mask({ bounds: CONTACT_AREA, mode: 'redact' })], source)
    expect(await scanPdfForText(result.bytes, ['private.person@example.org'])).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('form field'))).toBe(true)
  })

  it('reports redacted text that is still visible on another page', async () => {
    const doc = await PDFDocument.load(await buildSource())
    const font = await doc.embedFont(StandardFonts.Helvetica)
    doc.getPage(1).drawText(`Contact: ${EMAIL}`, { x: 40, y: 600, size: 10, font })
    const result = await exportWith([mask({ bounds: CONTACT_AREA, mode: 'redact' })], await doc.save())
    expect(result.redaction?.visibleElsewhere.some((entry) => entry.pageIndex === 1)).toBe(true)
    expect(result.redaction?.ok).toBe(true)
  })

  it('keeps covers as visual-only and leaves the original text in the file', async () => {
    const source = await buildSource()
    const result = await exportWith([mask({ bounds: CONTACT_AREA, fillColor: '#ffffff' })], source)
    expect(result.redaction).toBeNull()
    expect(await pageText(result.bytes, 0)).toContain(EMAIL)
    expect(result.warnings.some((warning) => warning.includes('not secure redaction'))).toBe(true)
  })

  it('never exports hidden (preview-only) regions', async () => {
    const source = await buildSource()
    const result = await exportWith([mask({ bounds: CONTACT_AREA, mode: 'hide' })], source)
    expect(result.exportedOverlayCount).toBe(0)
    expect(result.modifications.hidden).toBe(1)
    expect(await pageText(result.bytes, 0)).toContain(EMAIL)
  })

  it('labels modified pages in the exported copy, upright on rotated pages', async () => {
    const source = await buildSource()
    const result = await exportWith(
      [
        mask({ bounds: CONTACT_AREA, fillColor: '#ffffff' }),
        mask({ pageIndex: 1, bounds: { x: 30, y: 690, width: 200, height: 20 }, fillColor: '#ffffff' }),
      ],
      source,
      true,
    )
    const reopened = await PDFDocument.load(result.bytes)
    expect(reopened.getKeywords()).toContain('Modified copy')

    const pdf = await openPdfJs(result.bytes)
    const page = await pdf.getPage(2)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const notice = content.items.find(
      (item) => 'str' in item && item.str.startsWith('Modified copy'),
    ) as { str: string; transform: number[] } | undefined
    expect(notice?.str).toContain('1 visual cover')
    const [a, b, , , e, f] = pdfjs.Util.transform(viewport.transform, notice!.transform)
    expect(a).toBeGreaterThan(0)
    expect(Math.abs(b ?? 0)).toBeLessThan(0.01)
    expect(e).toBeLessThan(20)
    expect(f).toBeGreaterThan(viewport.height - 20)
    await pdf.loadingTask.destroy()
  })
})
