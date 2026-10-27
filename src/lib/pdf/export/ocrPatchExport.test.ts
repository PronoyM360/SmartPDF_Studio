import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { degrees, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { exportEditedPdf } from '@/lib/pdf/export/exportEditedPdf'
import { ocrEditCheck, renderProbePages } from '@/lib/pdf/export/exportQualityChecks'
import type { PdfSource } from '@/types'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import type { TextOverlayObject } from '@/types/textOverlay'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Minimal RGBA PNG encoder so the test uses a real patch with transparency. */
function encodePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width; x += 1) {
      raw.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

async function scannedTicketSource(): Promise<PdfSource> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const upright = doc.addPage([300, 200])
  upright.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(1, 0.95, 0.8) })
  upright.drawText('TOTAL 12.50', { x: 40, y: 100, size: 14, font })
  const rotated = doc.addPage([200, 300])
  rotated.setRotation(degrees(90))
  rotated.drawText('9.99', { x: 60, y: 150, size: 12, font })
  const bytes = await doc.save()
  return { name: 'ticket.pdf', byteLength: bytes.byteLength, originalBytes: bytes }
}

function patchedEdit(pageIndex: number, assetId: string, bounds: MaskOverlayObject['bounds']): OverlayObject[] {
  const now = Date.now()
  const mask: MaskOverlayObject = {
    id: `mask-${pageIndex}`,
    kind: 'mask',
    pageIndex,
    bounds,
    fillColor: '#fff2cc',
    opacity: 1,
    createdAt: now,
    updatedAt: now,
    backgroundPatch: { assetId, method: 'inpaint', backgroundKind: 'solid' },
  }
  const text: TextOverlayObject = {
    id: `text-${pageIndex}`,
    kind: 'text',
    pageIndex,
    bounds,
    content: '15.75',
    fontFamily: 'Arial',
    fontSize: 12,
    color: '#111111',
    alignment: 'right',
    createdAt: now,
    updatedAt: now,
    ocrEdit: { recognizedText: '12.50', confidence: 88, backgroundKind: 'solid', repairMethod: 'inpaint' },
  }
  return [mask, text]
}

function embeddedImageSizes(doc: PDFDocument): { width: number; height: number; hasAlpha: boolean }[] {
  const sizes: { width: number; height: number; hasAlpha: boolean }[] = []
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) {
      continue
    }
    const dict: PDFDict = object.dict
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image') || dict.get(PDFName.of('SMask')) === undefined) {
      continue
    }
    sizes.push({
      width: (dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
      height: (dict.get(PDFName.of('Height')) as PDFNumber).asNumber(),
      hasAlpha: true,
    })
  }
  return sizes
}

describe('OCR patch export', () => {
  it('embeds reconstructed patches as-is and leaves the source untouched', async () => {
    const source = await scannedTicketSource()
    const sourceHash = createHash('sha256').update(source.originalBytes).digest('hex')
    const patch = encodePng(37, 11, (x) => (x % 5 === 0 ? [255, 242, 204, 255] : [0, 0, 0, 0]))
    const overlays = [
      ...patchedEdit(0, 'patch-a', { x: 80, y: 96, width: 36, height: 14 }),
      ...patchedEdit(1, 'patch-a', { x: 56, y: 146, width: 14, height: 30 }),
    ]

    const result = await exportEditedPdf({
      source,
      overlays,
      getImageBytes: (id) => (id === 'patch-a' ? patch : undefined),
    })

    expect(result.verification.ok).toBe(true)
    expect(createHash('sha256').update(source.originalBytes).digest('hex')).toBe(sourceHash)
    expect(result.warnings.join(' ')).not.toContain('flat fill was used')
    expect(result.modifications).toMatchObject({ covers: 0, textEdits: 2 })

    const exported = await PDFDocument.load(result.bytes.slice())
    expect(exported.getPageCount()).toBe(2)
    expect(exported.getPage(0).getSize()).toEqual({ width: 300, height: 200 })
    expect(exported.getPage(1).getRotation().angle).toBe(90)
    const images = embeddedImageSizes(exported)
    expect(images.filter((image) => image.width === 37 && image.height === 11)).toHaveLength(2)
  })

  it('falls back to a flat fill when patch data is missing', async () => {
    const source = await scannedTicketSource()
    const result = await exportEditedPdf({
      source,
      overlays: patchedEdit(0, 'missing', { x: 80, y: 96, width: 36, height: 14 }),
      getImageBytes: () => undefined,
    })
    expect(result.verification.ok).toBe(true)
    expect(result.warnings.join(' ')).toContain('flat fill was used instead')
  })

  it('describes OCR edits and renders every edited page', () => {
    const overlays = [
      ...patchedEdit(0, 'a', { x: 0, y: 0, width: 10, height: 10 }),
      ...patchedEdit(3, 'b', { x: 0, y: 0, width: 10, height: 10 }),
    ]
    const check = ocrEditCheck(overlays)
    expect(check?.status).toBe('warning')
    expect(check?.detail).toContain('2 OCR-assisted edit(s) on page 1, 4')
    expect(check?.detail).toContain('2 inpainted')
    expect(renderProbePages(overlays, 5)).toEqual([0, 3])
    expect(renderProbePages([], 5)).toEqual([0])
  })
})
