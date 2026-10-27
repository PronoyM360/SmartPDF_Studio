import { degrees, PDFDocument, PDFString, rgb, StandardFonts } from 'pdf-lib'
import type { PageRect } from '@/types'

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

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** zlib stream made of uncompressed (stored) deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  const view = new DataView(out.buffer)
  out[0] = 0x78
  out[1] = 0x01
  let offset = 2
  for (let block = 0; block < blocks; block += 1) {
    const chunk = data.subarray(block * 65535, Math.min(data.length, (block + 1) * 65535))
    out[offset] = block === blocks - 1 ? 1 : 0
    view.setUint16(offset + 1, chunk.length, true)
    view.setUint16(offset + 3, ~chunk.length & 0xffff, true)
    out.set(chunk, offset + 5)
    offset += 5 + chunk.length
  }
  view.setUint32(offset, adler32(data))
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Minimal RGBA PNG encoder for test fixtures (no compression). */
export function encodeRgbaPng(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array {
  const stride = width * 4 + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw.set(paint(x, y), y * stride + 1 + x * 4)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

export interface ExportFixtureLayout {
  readonly pageSizes: readonly { width: number; height: number; rotation: number }[]
  /** Section "PAYMENT DETAILS" on page 1, with the card number inside. */
  readonly section: { pageIndex: number; bounds: PageRect; texts: readonly string[] }
  /** Printed amount on page 1. */
  readonly price: { pageIndex: number; text: string; bounds: PageRect; baselineY: number; fontSize: number }
  /** Price printed inside an embedded image on page 3 (image-only, not text). */
  readonly imagePrice: { pageIndex: number; bounds: PageRect }
  /** Reference line on the 180°-rotated, crop-boxed page 4. */
  readonly reference: { pageIndex: number; text: string; bounds: PageRect }
  /** Text that must survive everywhere it was not edited. */
  readonly untouchedTexts: readonly { pageIndex: number; text: string }[]
  readonly cropBox: PageRect
  readonly title: string
  readonly creationDate: Date
}

export interface ExportFixture {
  readonly bytes: Uint8Array
  readonly layout: ExportFixtureLayout
}

const TAG_PX = { width: 160, height: 64 }
const TAG_PRICE_PX = { x0: 90, x1: 150, y0: 20, y1: 44 }
const TAG_PLACEMENT = { x: 40, y: 400, scale: 1.5 }

/**
 * Multi-page invoice-like document: Letter, rotated A4, A5 with an embedded price
 * image, and a 180°-rotated page with a CropBox smaller than its MediaBox.
 */
export async function createExportFixturePdf(): Promise<ExportFixture> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.1, 0.12)
  const title = 'ACME Invoice 2026-0412'
  const creationDate = new Date('2026-01-02T03:04:05Z')
  doc.setTitle(title)
  doc.setCreator('Export fixture generator')
  doc.setCreationDate(creationDate)

  const letter = doc.addPage([612, 792])
  letter.drawText('ACME INVOICE', { x: 60, y: 730, size: 20, font: bold, color: ink })
  letter.drawText('Customer: Jane Doe', { x: 60, y: 700, size: 12, font, color: ink })
  letter.drawText('PAYMENT DETAILS', { x: 60, y: 640, size: 12, font: bold, color: ink })
  letter.drawText('Card number 4111 1111 1111 1111', { x: 60, y: 622, size: 10, font, color: ink })
  letter.drawText('Account holder Jane Doe', { x: 60, y: 606, size: 10, font, color: ink })
  letter.drawText('Total', { x: 60, y: 500, size: 14, font: bold, color: ink })
  const priceText = '$1,250.00'
  const priceWidth = bold.widthOfTextAtSize(priceText, 14)
  const priceX = 552 - priceWidth
  letter.drawText(priceText, { x: priceX, y: 500, size: 14, font: bold, color: ink })
  letter.drawText('Thank you for your business.', { x: 60, y: 80, size: 10, font, color: ink })
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [60, 725, 250, 752],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/invoice') },
  })
  letter.node.addAnnot(doc.context.register(link))

  const a4 = doc.addPage([595.28, 841.89])
  a4.setRotation(degrees(90))
  a4.drawText('Terms and conditions', { x: 60, y: 760, size: 14, font: bold, color: ink })
  a4.drawText('Clause 7.3: unrelated content must stay intact.', { x: 60, y: 740, size: 10, font, color: ink })

  const a5 = doc.addPage([420, 595])
  a5.drawText('Scanned price tag', { x: 40, y: 540, size: 12, font: bold, color: ink })
  const tag = encodeRgbaPng(TAG_PX.width, TAG_PX.height, (x, y) =>
    x >= TAG_PRICE_PX.x0 && x < TAG_PRICE_PX.x1 && y >= TAG_PRICE_PX.y0 && y < TAG_PRICE_PX.y1 && x % 6 < 4
      ? [30, 30, 30, 255]
      : [250, 220, 80, 255],
  )
  const tagImage = await doc.embedPng(tag)
  a5.drawImage(tagImage, {
    x: TAG_PLACEMENT.x,
    y: TAG_PLACEMENT.y,
    width: TAG_PX.width * TAG_PLACEMENT.scale,
    height: TAG_PX.height * TAG_PLACEMENT.scale,
  })
  a5.drawText('Price shown above is part of the image.', { x: 40, y: 360, size: 9, font, color: ink })

  const cropped = doc.addPage([500, 700])
  cropped.setRotation(degrees(180))
  const cropBox = { x: 20, y: 20, width: 460, height: 660 }
  cropped.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height)
  cropped.drawText('Reference XYZ-123', { x: 60, y: 600, size: 12, font, color: ink })
  cropped.drawText('Crop-boxed page footer', { x: 60, y: 560, size: 12, font, color: ink })

  const bytes = await doc.save()

  const s = TAG_PLACEMENT.scale
  const imagePriceBounds: PageRect = {
    x: TAG_PLACEMENT.x + TAG_PRICE_PX.x0 * s - 3,
    y: TAG_PLACEMENT.y + (TAG_PX.height - TAG_PRICE_PX.y1) * s - 3,
    width: (TAG_PRICE_PX.x1 - TAG_PRICE_PX.x0) * s + 6,
    height: (TAG_PRICE_PX.y1 - TAG_PRICE_PX.y0) * s + 6,
  }

  return {
    bytes,
    layout: {
      pageSizes: [
        { width: 612, height: 792, rotation: 0 },
        { width: 595.28, height: 841.89, rotation: 90 },
        { width: 420, height: 595, rotation: 0 },
        { width: 500, height: 700, rotation: 180 },
      ],
      section: {
        pageIndex: 0,
        bounds: { x: 50, y: 598, width: 320, height: 60 },
        texts: ['PAYMENT DETAILS', 'Card number 4111 1111 1111 1111', 'Account holder Jane Doe'],
      },
      price: {
        pageIndex: 0,
        text: priceText,
        bounds: { x: priceX - 2, y: 496, width: priceWidth + 4, height: 18 },
        baselineY: 500,
        fontSize: 14,
      },
      imagePrice: { pageIndex: 2, bounds: imagePriceBounds },
      reference: { pageIndex: 3, text: 'Reference XYZ-123', bounds: { x: 50, y: 594, width: 160, height: 22 } },
      untouchedTexts: [
        { pageIndex: 0, text: 'ACME INVOICE' },
        { pageIndex: 0, text: 'Customer: Jane Doe' },
        { pageIndex: 0, text: 'Thank you for your business.' },
        { pageIndex: 1, text: 'Clause 7.3: unrelated content must stay intact.' },
        { pageIndex: 2, text: 'Price shown above is part of the image.' },
        { pageIndex: 3, text: 'Crop-boxed page footer' },
      ],
      cropBox,
      title,
      creationDate,
    },
  }
}
