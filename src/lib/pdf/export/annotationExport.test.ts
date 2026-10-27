import { createHash } from 'node:crypto'
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  rgb,
  StandardFonts,
} from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { exportEditedPdf } from '@/lib/pdf/export/exportEditedPdf'
import { describeExportedModifications, summarizeModifications } from '@/lib/redaction/maskModes'
import { buildTrackedChanges } from '@/lib/changes/trackedChanges'
import type { AnnotationOverlayObject } from '@/types/annotationOverlay'
import type { PdfSource } from '@/types'

async function source(): Promise<PdfSource> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([612, 792]).drawText('Section A', { x: 72, y: 700, size: 12, font, color: rgb(0, 0, 0) })
  const small = doc.addPage([420, 298])
  small.setRotation(degrees(90))
  small.drawText('Fare 9.99', { x: 40, y: 200, size: 11, font })
  const bytes = await doc.save()
  return { name: 'annotations.pdf', byteLength: bytes.byteLength, originalBytes: bytes }
}

function annotation(pageIndex: number, note: string): AnnotationOverlayObject {
  const now = Date.now()
  return {
    id: `note-${pageIndex}`,
    kind: 'annotation',
    pageIndex,
    bounds: { x: 60, y: 690, width: 120, height: 30 },
    note,
    color: '#e11d48',
    createdAt: now,
    updatedAt: now,
  }
}

function pageAnnots(doc: PDFDocument, pageIndex: number): PDFDict[] {
  const annots = doc.getPage(pageIndex).node.lookup(PDFName.of('Annots'))
  if (!(annots instanceof PDFArray)) {
    return []
  }
  return annots.asArray().map((ref) => doc.context.lookup(ref) as PDFDict)
}

describe('annotation export', () => {
  it('adds PDF comment annotations without touching page content', async () => {
    const src = await source()
    const before = createHash('sha256').update(src.originalBytes).digest('hex')
    const sourceDoc = await PDFDocument.load(src.originalBytes.slice())
    const contentRefs = sourceDoc.getPages().map((page) => String(page.node.get(PDFName.of('Contents'))))

    const overlays = [annotation(0, 'Check this section'), { ...annotation(1, 'Fare looks wrong'), bounds: { x: 30, y: 190, width: 80, height: 20 } }]
    const result = await exportEditedPdf({ source: src, overlays, getImageBytes: () => undefined })

    expect(result.verification.ok).toBe(true)
    expect(createHash('sha256').update(src.originalBytes).digest('hex')).toBe(before)
    const exported = await PDFDocument.load(result.bytes.slice())
    // The original content stream is kept; pdf-lib may only wrap it in q/Q. Annotations
    // live outside the page content.
    exported.getPages().forEach((page, index) => {
      const contents = page.node.get(PDFName.of('Contents'))
      const refs = contents instanceof PDFArray ? contents.asArray().map(String) : [String(contents)]
      const original = contentRefs[index]!.replace(/[[\]]/g, '').trim()
      expect(refs).toContain(original)
      for (const ref of refs.filter((entry) => entry !== original)) {
        const stream = exported.context.lookup(PDFRef.of(Number(ref.split(' ')[0])))
        const text = new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode()).trim()
        expect(['q', 'Q']).toContain(text)
      }
    })

    const [first] = pageAnnots(exported, 0)
    expect(first?.get(PDFName.of('Subtype'))).toBe(PDFName.of('Square'))
    expect((first?.get(PDFName.of('Contents')) as PDFHexString).decodeText()).toBe('Check this section')
    const rect = (first?.get(PDFName.of('Rect')) as PDFArray).asArray().map((value) => (value as PDFNumber).asNumber())
    expect(rect).toEqual([60, 690, 180, 720])
    expect(first?.get(PDFName.of('AP'))).toBeInstanceOf(PDFDict)

    const [rotated] = pageAnnots(exported, 1)
    expect((rotated?.get(PDFName.of('Contents')) as PDFHexString).decodeText()).toBe('Fare looks wrong')
    expect(exported.getPage(1).getRotation().angle).toBe(90)
    expect(result.warnings.join(' ')).toContain('added as PDF comments')
  })

  it('counts annotations separately from covers in summaries and the change list', () => {
    const overlays = [annotation(0, 'Note')]
    const summary = summarizeModifications(overlays)
    expect(summary).toMatchObject({ annotations: 1, covers: 0, textEdits: 0 })
    expect(describeExportedModifications(summary)).toBe('1 annotation')
    expect(buildTrackedChanges(overlays)[0]).toMatchObject({ kind: 'annotation-added', after: 'Note', inExport: true })
  })
})
