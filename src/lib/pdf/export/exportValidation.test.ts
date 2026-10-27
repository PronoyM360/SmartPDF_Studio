import { createHash } from 'node:crypto'
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { buildExportFilename } from '@/lib/pdf/export/downloadPdf'
import { exportEditedPdf, type ExportEditedPdfResult } from '@/lib/pdf/export/exportEditedPdf'
import { createPdfJsExportReader, type OpenExportPdfReader } from '@/lib/pdf/export/exportPdfReader'
import type { ExportProgress } from '@/lib/pdf/export/exportProgress'
import { runExportQualityChecks } from '@/lib/pdf/export/exportQualityChecks'
import {
  createExportFixturePdf,
  encodeRgbaPng,
  type ExportFixtureLayout,
} from '@/lib/pdf/export/fixtures/createExportFixturePdf'
import { regionFillCoverage } from '@/lib/pdf/export/inspectExportedPdf'
import { EDITED_COPY_PRODUCER } from '@/lib/redaction/markModifiedCopy'
import type { OpenPdfInspector } from '@/lib/redaction/types'
import type { PdfSource } from '@/types'
import type { ImageOverlayObject } from '@/types/imageOverlay'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import type { TextOverlayObject } from '@/types/textOverlay'

async function openPdfJs(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return (await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise) as unknown as PDFDocumentProxy
}

const openNodeReader: OpenExportPdfReader = async (bytes) => createPdfJsExportReader(await openPdfJs(bytes))

interface NodeCanvas {
  toBuffer(mime: 'image/png'): Uint8Array
}

/** Node stand-in for the browser inspector: real PDF.js text and real rasterization. */
const openNodeInspector: OpenPdfInspector = async (bytes) => {
  const pdf = await openPdfJs(bytes)
  const reader = createPdfJsExportReader(pdf)
  const factory = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: NodeCanvas; context: CanvasRenderingContext2D }; destroy(pair: unknown): void } }).canvasFactory
  return {
    pageCount: pdf.numPages,
    readPageText: async (pageIndex) =>
      (await extractPageTextItems(pdf, pageIndex)).map((item) => ({ text: item.text, bounds: item.bounds })),
    rasterizeWithRedactions: async (pageIndex, areas) => {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: 2, rotation: 0 })
      const pair = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        pair.context.fillStyle = '#ffffff'
        pair.context.fillRect(0, 0, viewport.width, viewport.height)
        await page.render({ canvasContext: pair.context, viewport, canvas: pair.canvas as unknown as HTMLCanvasElement }).promise
        for (const area of areas) {
          const [x0 = 0, y0 = 0] = viewport.convertToViewportPoint(area.bounds.x, area.bounds.y + area.bounds.height)
          const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(area.bounds.x + area.bounds.width, area.bounds.y)
          pair.context.fillStyle = area.fillColor
          pair.context.fillRect(Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1 - x0) + 2, Math.ceil(y1 - y0) + 2)
        }
        const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = page.view
        return {
          png: new Uint8Array(pair.canvas.toBuffer('image/png')),
          visibleBox: { x: vx0, y: vy0, width: vx1 - vx0, height: vy1 - vy0 },
        }
      } finally {
        factory.destroy(pair)
      }
    },
    measureFillCoverage: async (pageIndex, rect, fillColor) => {
      const render = await reader.renderPage(pageIndex, 1.5)
      return render ? regionFillCoverage(render, rect, fillColor) : null
    },
    destroy: () => reader.destroy(),
  }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const NOW = 1_780_000_000_000
const EXPORT_DATE = new Date('2026-10-27T10:00:00Z')

function mask(partial: Partial<MaskOverlayObject> & Pick<MaskOverlayObject, 'id' | 'pageIndex' | 'bounds'>): MaskOverlayObject {
  return { kind: 'mask', fillColor: '#ffffff', opacity: 1, mode: 'cover', createdAt: NOW, updatedAt: NOW, ...partial }
}

function priceEdit(layout: ExportFixtureLayout): [MaskOverlayObject, TextOverlayObject] {
  const { price } = layout
  return [
    mask({ id: 'price-mask', pageIndex: price.pageIndex, bounds: price.bounds, createdAt: NOW + 1, updatedAt: NOW + 1 }),
    {
      id: 'price-text',
      kind: 'text',
      pageIndex: price.pageIndex,
      bounds: price.bounds,
      content: '$1,375.00',
      fontFamily: 'Helvetica',
      fontSize: price.fontSize,
      fontWeight: 'bold',
      color: '#1a1a1a',
      alignment: 'right',
      createdAt: NOW + 2,
      updatedAt: NOW + 2,
      amendment: {
        kind: 'amount',
        targetKey: 'total',
        pageIndex: price.pageIndex,
        originalText: price.text,
        replacementText: '$1,375.00',
        originalValue: 1250,
        replacementValue: 1375,
        role: 'total',
        label: 'Total',
        source: 'pdf_text',
        fontMatch: 'approximate',
        fallbackFontFamily: 'Helvetica',
        fallbackFontWeight: 'bold',
        baselineY: price.baselineY,
        maskId: 'price-mask',
      },
    },
  ]
}

function imagePricePatch(layout: ExportFixtureLayout): ImageOverlayObject {
  return {
    id: 'tag-patch',
    kind: 'image',
    pageIndex: layout.imagePrice.pageIndex,
    bounds: layout.imagePrice.bounds,
    assetId: 'tag-patch',
    rotation: 0,
    lockAspectRatio: false,
    createdAt: NOW + 3,
    updatedAt: NOW + 3,
  }
}

const TAG_PATCH_PNG = encodeRgbaPng(32, 16, () => [40, 160, 60, 255])
const getImageBytes = (id: string) => (id === 'tag-patch' ? TAG_PATCH_PNG : undefined)

async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await openPdfJs(bytes)
  try {
    const texts: string[] = []
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      texts.push((await extractPageTextItems(pdf, pageIndex)).map((item) => item.text).join(' '))
    }
    return texts
  } finally {
    await pdf.loadingTask.destroy()
  }
}

function decodedContents(doc: PDFDocument, pageIndex: number): string[] {
  const contents = doc.getPage(pageIndex).node.Contents()
  const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  return entries.map((entry) => {
    const stream = entry instanceof PDFRef ? doc.context.lookup(entry) : entry
    return new TextDecoder('latin1').decode(decodePDFRawStream(stream as PDFRawStream).decode())
  })
}

function pageImageXObjects(doc: PDFDocument, pageIndex: number): number {
  const xobjects = doc.getPage(pageIndex).node.Resources()?.lookup(PDFName.of('XObject'))
  if (!(xobjects instanceof PDFDict)) {
    return 0
  }
  return xobjects
    .entries()
    .map(([, value]) => doc.context.lookup(value))
    .filter((value) => value instanceof PDFStream && value.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length
}

async function strokeOps(bytes: Uint8Array, pageIndex: number): Promise<number> {
  const pdf = await openPdfJs(bytes)
  try {
    const list = await (await pdf.getPage(pageIndex + 1)).getOperatorList()
    return Array.from(list.fnArray).filter((fn) => fn === pdfjs.OPS.stroke || fn === pdfjs.OPS.closeStroke).length
  } finally {
    await pdf.loadingTask.destroy()
  }
}

describe('validated export of an edited multi-page PDF', () => {
  let layout: ExportFixtureLayout
  let source: PdfSource
  let sourceHash: string
  let committed: OverlayObject[]
  let present: OverlayObject[]
  let liveReferenceBounds: MaskOverlayObject['bounds']
  let result: ExportEditedPdfResult
  const stages: ExportProgress['stage'][] = []

  beforeAll(async () => {
    const fixture = await createExportFixturePdf()
    layout = fixture.layout
    source = { name: 'invoice.pdf', byteLength: fixture.bytes.byteLength, originalBytes: fixture.bytes }
    sourceHash = sha256(fixture.bytes)

    const referenceMask = mask({
      id: 'reference',
      pageIndex: layout.reference.pageIndex,
      bounds: layout.reference.bounds,
      fillColor: '#000000',
      label: 'Reference',
    })
    committed = [
      mask({
        id: 'section',
        pageIndex: layout.section.pageIndex,
        bounds: layout.section.bounds,
        label: 'Payment details',
        sourceSectionId: 'sec-payment',
      }),
      ...priceEdit(layout),
      imagePricePatch(layout),
      referenceMask,
      mask({ id: 'hidden', pageIndex: 1, bounds: { x: 40, y: 700, width: 300, height: 80 }, mode: 'hide' }),
    ]
    liveReferenceBounds = { ...referenceMask.bounds, x: referenceMask.bounds.x + 200 }
    present = [
      ...committed.map((object) =>
        object.id === 'reference' ? { ...referenceMask, bounds: liveReferenceBounds, updatedAt: NOW + 50 } : object,
      ),
      {
        id: 'draft',
        kind: 'text',
        pageIndex: 1,
        bounds: { x: 60, y: 600, width: 200, height: 20 },
        content: 'DRAFT 999.99',
        fontFamily: 'Helvetica',
        fontSize: 12,
        color: '#ff0000',
        alignment: 'left',
        createdAt: NOW + 60,
        updatedAt: NOW + 60,
      } satisfies TextOverlayObject,
    ]

    result = await exportEditedPdf({
      source,
      overlays: present,
      committedOverlays: committed,
      getImageBytes,
      openInspector: openNodeInspector,
      openReader: openNodeReader,
      markModifiedPages: true,
      now: EXPORT_DATE,
      onProgress: (progress) => stages.push(progress.stage),
    })
  })

  it('never mutates the original bytes and reports every export stage', () => {
    expect(sha256(source.originalBytes)).toBe(sourceHash)
    expect(source.originalBytes.byteLength).toBe(source.byteLength)
    expect([...new Set(stages)]).toEqual(['preparing', 'applying', 'saving', 'validating', 'done'])
  })

  it('reopens the export with PDF.js: same page count, order, sizes and rotations', async () => {
    expect(result.inspection?.opened).toBe(true)
    expect(result.inspection?.exportedPageCount).toBe(4)
    expect(result.inspection?.geometryErrors).toEqual([])

    const pdf = await openPdfJs(result.bytes)
    try {
      expect(pdf.numPages).toBe(layout.pageSizes.length)
      for (const [index, expected] of layout.pageSizes.entries()) {
        const page = await pdf.getPage(index + 1)
        expect(page.rotate).toBe(expected.rotation)
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
        const visible = index === 3 ? layout.cropBox : { width: expected.width, height: expected.height }
        expect(x1 - x0).toBeCloseTo(visible.width, 2)
        expect(y1 - y0).toBeCloseTo(visible.height, 2)
      }
    } finally {
      await pdf.loadingTask.destroy()
    }

    const reopened = await PDFDocument.load(result.bytes)
    expect(reopened.getPage(3).getCropBox()).toEqual(layout.cropBox)
    expect(reopened.getPage(3).getMediaBox()).toEqual({ x: 0, y: 0, width: 500, height: 700 })
    expect(result.verification.ok).toBe(true)
  })

  it('keeps untouched content intact: byte-identical streams, same text and pixels', async () => {
    expect(result.verification.contentIntegrity?.pages.map((page) => page.status)).toEqual([
      'preserved',
      'identical',
      'preserved',
      'preserved',
    ])
    const original = await PDFDocument.load(source.originalBytes.slice())
    const exported = await PDFDocument.load(result.bytes)
    expect(decodedContents(exported, 1)).toEqual(decodedContents(original, 1))
    // Edited pages keep the original stream, wrapped in q/Q, with new drawing appended.
    expect(decodedContents(exported, 0)).toEqual(expect.arrayContaining(decodedContents(original, 0)))

    const untouched = result.inspection!.pages[1]!
    expect(untouched).toMatchObject({ edited: false, textMatchesOriginal: true })
    expect(untouched.pixelDifference).not.toBeNull()
    expect(untouched.pixelDifference!).toBeLessThanOrEqual(0.001)

    const texts = await pageTexts(result.bytes)
    for (const { pageIndex, text } of layout.untouchedTexts) {
      expect(texts[pageIndex]).toContain(text)
    }
    expect(exported.getPage(0).node.Annots()?.size()).toBe(1)
  })

  it('updates the text price and says the old value is still underneath', async () => {
    const texts = await pageTexts(result.bytes)
    expect(texts[0]).toContain('$1,375.00')
    const check = result.inspection!.edits.find((edit) => edit.changeId === 'price-text')!
    expect(check).toMatchObject({ kind: 'price-updated', status: 'warning', method: 'text+render' })
    expect(check.detail).toContain('still in the file underneath')
    expect(texts[0]).toContain('Modified copy')
  })

  it('covers the removed section visually and does not call it redaction', async () => {
    const check = result.inspection!.edits.find((edit) => edit.changeId === 'section')!
    expect(check).toMatchObject({ kind: 'section', title: 'Section covered', status: 'warning', method: 'text+render' })
    expect(check.detail).toMatch(/100% of the area renders in the cover colour/)
    expect(check.detail).toContain('not redaction')
    const texts = await pageTexts(result.bytes)
    // Honest result: a cover leaves the text extractable.
    expect(texts[0]).toContain('4111 1111 1111 1111')
    expect(texts[0]).toContain('ACME INVOICE')
    expect(texts[0]).toContain('Thank you for your business.')
  })

  it('masks a region on the 180°-rotated, crop-boxed page at its committed position', async () => {
    const check = result.inspection!.edits.find((edit) => edit.changeId === 'reference')!
    expect(check.status).toBe('warning')
    expect(check.detail).toContain('100% of the area renders in the cover colour')

    const reader = await openNodeReader(result.bytes)
    try {
      const render = (await reader.renderPage(3, 1.5))!
      expect(regionFillCoverage(render, layout.reference.bounds, '#000000')).toBeGreaterThan(0.95)
      expect(regionFillCoverage(render, liveReferenceBounds, '#000000')!).toBeLessThan(0.5)
    } finally {
      await reader.destroy()
    }
  })

  it('edits the image-based price with an overlay and warns that the image data remains', async () => {
    const check = result.inspection!.edits.find((edit) => edit.changeId === 'tag-patch')!
    expect(check).toMatchObject({ kind: 'image-added', status: 'verified', method: 'render' })
    expect(result.featureWarnings.join(' ')).toMatch(/Page 3 contains embedded image\(s\).*stays in the file/)
    expect(result.limitations.join(' ')).toContain('original image pixels remain in the file')

    const original = await PDFDocument.load(source.originalBytes.slice())
    const exported = await PDFDocument.load(result.bytes)
    expect(pageImageXObjects(original, 2)).toBe(1)
    expect(pageImageXObjects(exported, 2)).toBe(2)

    const reader = await openNodeReader(result.bytes)
    try {
      const render = (await reader.renderPage(2, 1.5))!
      expect(regionFillCoverage(render, layout.imagePrice.bounds, '#28a03c')).toBeGreaterThan(0.95)
    } finally {
      await reader.destroy()
    }
  })

  it('excludes uncommitted and hidden operations', async () => {
    expect(result.exportedOverlayCount).toBe(5)
    expect(result.selection.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'draft', reason: 'uncommitted', committedVersionExported: false }),
        expect.objectContaining({ id: 'reference', reason: 'uncommitted', committedVersionExported: true }),
        expect.objectContaining({ id: 'hidden', reason: 'hidden' }),
      ]),
    )
    const texts = await pageTexts(result.bytes)
    expect(texts.join(' ')).not.toContain('DRAFT')
    expect(result.modifications.hidden).toBe(1)
  })

  it('draws no editor artifacts (no outlines, handles or guides)', async () => {
    expect(result.verification.addedStrokeOperators).toBe(0)
    for (const pageIndex of [0, 2, 3]) {
      expect(await strokeOps(result.bytes, pageIndex)).toBe(await strokeOps(source.originalBytes, pageIndex))
    }
  })

  it('labels the output as an edited copy without rewriting the original identity', async () => {
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false })
    expect(doc.getProducer()).toBe(EDITED_COPY_PRODUCER)
    expect(doc.getModificationDate()?.toISOString()).toBe(EXPORT_DATE.toISOString())
    expect(doc.getKeywords()).toMatch(/Modified copy \(SmartPDF Studio, 2026-10-27\): .*1 edited amount/)
    expect(doc.getTitle()).toBe(layout.title)
    expect(doc.getCreator()).toBe('Export fixture generator')
    expect(doc.getCreationDate()?.toISOString()).toBe(layout.creationDate.toISOString())
    expect(buildExportFilename(source.name)).toBe('invoice-edited.pdf')
  })

  it('produces a downloadable quality report with honest warnings', async () => {
    const report = await runExportQualityChecks({
      source,
      overlays: present,
      committedOverlays: committed,
      getImageBytes,
      expectedPageCount: 4,
      markModifiedPages: true,
      openInspector: openNodeInspector,
      openReader: openNodeReader,
    })
    const status = (id: string) => report.checks.find((check) => check.id === id)?.status
    expect(report.canDownload).toBe(true)
    expect(status('pdfjs_reopen')).toBe('passed')
    expect(status('page_layout')).toBe('passed')
    expect(status('content_preserved')).toBe('passed')
    expect(status('untouched_pages')).toBe('passed')
    expect(status('no_editor_chrome')).toBe('passed')
    expect(status('modified_label')).toBe('passed')
    expect(status('edits_visible')).toBe('warning')
    expect(status('committed_only')).toBe('warning')
    expect(status('visual_covers')).toBe('warning')
    expect(status('document_features')).toBe('warning')
    expect(report.limitations.join(' ')).toContain('not byte-identical')
    expect(report.excluded.map((entry) => entry.id).sort()).toEqual(['draft', 'hidden', 'reference'])
  })
})

describe('validated export with a redacted section', () => {
  it('removes the section text, keeps other pages intact and verifies it', async () => {
    const { bytes, layout } = await createExportFixturePdf()
    const source: PdfSource = { name: 'invoice.pdf', byteLength: bytes.byteLength, originalBytes: bytes }
    const result = await exportEditedPdf({
      source,
      overlays: [
        mask({
          id: 'section',
          pageIndex: 0,
          bounds: layout.section.bounds,
          fillColor: '#000000',
          mode: 'redact',
          label: 'Payment details',
          sourceSectionId: 'sec-payment',
        }),
      ],
      getImageBytes,
      openInspector: openNodeInspector,
      openReader: openNodeReader,
    })

    expect(result.redaction?.ok).toBe(true)
    expect(result.flattenedPages).toEqual([0])
    const check = result.inspection!.edits.find((edit) => edit.changeId === 'section')!
    expect(check).toMatchObject({ title: 'Section redacted', status: 'verified', method: 'text+render' })

    const texts = await pageTexts(result.bytes)
    expect(texts[0]).not.toContain('4111')
    expect(texts[0]).not.toContain('PAYMENT DETAILS')
    expect(result.verification.contentIntegrity?.pages.map((page) => page.status)).toEqual([
      'replaced',
      'identical',
      'identical',
      'identical',
    ])
    for (const { pageIndex, text } of layout.untouchedTexts.filter((entry) => entry.pageIndex > 0)) {
      expect(texts[pageIndex]).toContain(text)
    }
    expect(result.inspection!.pages.slice(1).every((page) => page.textMatchesOriginal === true)).toBe(true)

    // The rest of page 1 is still visible, now as pixels: the title area is not blank.
    const reader = await openNodeReader(result.bytes)
    try {
      const render = (await reader.renderPage(0, 1))!
      expect(regionFillCoverage(render, { x: 60, y: 728, width: 160, height: 22 }, '#ffffff')!).toBeLessThan(0.9)
      expect(regionFillCoverage(render, layout.section.bounds, '#000000')!).toBeGreaterThan(0.98)
    } finally {
      await reader.destroy()
    }
  })
})
