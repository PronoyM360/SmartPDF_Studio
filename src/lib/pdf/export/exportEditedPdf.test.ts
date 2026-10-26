import { degrees, PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { exportEditedPdf } from '@/lib/pdf/export/exportEditedPdf'
import { verifyExportedPdf } from '@/lib/pdf/export/verifyExportedPdf'
import { readPdfLibPageFingerprints } from '@/lib/pdf/export/pageFingerprints'
import type { PdfSource } from '@/types'
import type { TextOverlayObject } from '@/types/textOverlay'

async function createTwoPageSource(): Promise<PdfSource> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const rotated = doc.addPage([420, 612])
  rotated.setRotation(degrees(90))
  const bytes = await doc.save()
  return {
    name: 'structure-test.pdf',
    byteLength: bytes.byteLength,
    originalBytes: bytes,
  }
}

describe('exportEditedPdf', () => {
  it('preserves page structure and embeds text overlays', async () => {
    const source = await createTwoPageSource()
    const sourceDoc = await PDFDocument.load(source.originalBytes.slice())
    const sourceFingerprints = readPdfLibPageFingerprints(sourceDoc)

    const now = Date.now()
    const overlay: TextOverlayObject = {
      id: 't1',
      kind: 'text',
      pageIndex: 0,
      bounds: { x: 72, y: 700, width: 60, height: 14 },
      content: '5884',
      fontFamily: 'Helvetica',
      fontSize: 12,
      color: '#16a34a',
      alignment: 'left',
      fontWeight: 'bold',
      createdAt: now,
      updatedAt: now,
    }

    const result = await exportEditedPdf({
      source,
      overlays: [overlay],
      getImageBytes: () => undefined,
    })

    expect(result.verification.ok).toBe(true)
    expect(result.verification.readable).toBe(true)
    expect(result.bytes.byteLength).toBeGreaterThan(source.byteLength)

    const reverified = await verifyExportedPdf(
      sourceFingerprints,
      result.bytes,
    )
    expect(reverified.ok).toBe(true)

    const exportedDoc = await PDFDocument.load(result.bytes.slice())
    expect(exportedDoc.getPageCount()).toBe(2)
    expect(exportedDoc.getPage(1).getRotation().angle).toBe(90)
  })

  it('exports overlays independent of editor zoom (PDF point coordinates)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 400])
    page.drawText('5784', {
      x: 100,
      y: 300,
      size: 14,
      font: await doc.embedFont(StandardFonts.Helvetica),
      color: rgb(0, 0.5, 0),
    })
    const bytes = await doc.save()
    const source: PdfSource = {
      name: 'price.pdf',
      byteLength: bytes.byteLength,
      originalBytes: bytes,
    }

    const now = Date.now()
    const overlay: TextOverlayObject = {
      id: 'price',
      kind: 'text',
      pageIndex: 0,
      bounds: { x: 100, y: 286, width: 40, height: 16 },
      content: '5884',
      fontFamily: 'Helvetica',
      fontSize: 14,
      color: '#008000',
      alignment: 'left',
      createdAt: now,
      updatedAt: now,
    }

    const result = await exportEditedPdf({
      source,
      overlays: [overlay],
      getImageBytes: () => undefined,
    })

    expect(result.exportedOverlayCount).toBe(1)
    expect(result.verification.ok).toBe(true)
  })
})
