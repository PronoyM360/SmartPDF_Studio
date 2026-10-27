import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'

export const GREEN = rgb(0.09, 0.64, 0.29)
const INK = rgb(0.1, 0.1, 0.1)

interface Cell {
  readonly text: string
  readonly x: number
  /** Distance from the top of the page to the baseline. */
  readonly top: number
  readonly size?: number
  readonly bold?: boolean
  readonly color?: RGB
  /** Right edge x; when set, `x` is ignored and the text is right-aligned. */
  readonly right?: number
}

/** 1×1 grey PNG standing in for a scanned page. */
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
)

function draw(page: PDFPage, cells: readonly Cell[], regular: PDFFont, bold: PDFFont): void {
  const height = page.getHeight()
  for (const cell of cells) {
    const size = cell.size ?? 10
    const font = cell.bold ? bold : regular
    const x = cell.right !== undefined ? cell.right - font.widthOfTextAtSize(cell.text, size) : cell.x
    page.drawText(cell.text, { x, y: height - cell.top, size, font, color: cell.color ?? INK })
  }
}

const RIGHT = 560

/** Page 1: e-ticket with a right-aligned fare box (integers, BDT) and many non-price numbers. */
export const TICKET_CELLS: readonly Cell[] = [
  { text: 'ELECTRONIC TICKET RECEIPT', x: 40, top: 60, size: 16, bold: true },
  { text: 'Ticket Number: 997 2401234567', x: 40, top: 90 },
  { text: 'Booking Ref (PNR): AB12CD', x: 320, top: 90 },
  { text: 'Issued: 12 JAN 2026', x: 40, top: 106 },
  { text: 'Phone: +880 1700 000000', x: 320, top: 106 },
  { text: 'Flight BG 147', x: 40, top: 140 },
  { text: 'DAC 10:30 - CXB 11:35', x: 200, top: 140 },
  { text: 'Baggage: 20 KG', x: 400, top: 140 },
  { text: 'FARE DETAILS', x: 40, top: 190, size: 12, bold: true },
  { text: 'Base Fare', x: 40, top: 212 },
  { text: 'BDT 5,000', x: 0, right: RIGHT, top: 212 },
  { text: 'Tax', x: 40, top: 228 },
  { text: 'BDT 584', x: 0, right: RIGHT, top: 228 },
  { text: 'Service Charge', x: 40, top: 244 },
  { text: 'BDT 200', x: 0, right: RIGHT, top: 244 },
  { text: 'Gross Fare: 5784', x: 40, top: 266, size: 12, bold: true },
  { text: 'Discount', x: 40, top: 284 },
  { text: 'BDT 100', x: 0, right: RIGHT, top: 284 },
  { text: 'Total Price', x: 40, top: 308, size: 14, bold: true },
  { text: 'BDT 5,684', x: 0, right: RIGHT, top: 308, size: 14, bold: true, color: GREEN },
  { text: 'Amount Paid', x: 40, top: 328 },
  { text: 'BDT 5,684', x: 0, right: RIGHT, top: 328 },
]

/** Page 2: invoice table (Times) with decimals, several currencies and duplicate values. */
export const INVOICE_CELLS: readonly Cell[] = [
  { text: 'INVOICE', x: 40, top: 60, size: 18, bold: true },
  { text: 'Invoice No. 2026-0042', x: 40, top: 84 },
  { text: 'Date: 2026-01-12', x: 320, top: 84 },
  { text: 'Order #5784', x: 40, top: 100 },
  { text: 'VAT Reg No 123456789', x: 320, top: 100 },
  { text: 'Item', x: 40, top: 140, bold: true },
  { text: 'Base Fare', x: 0, right: 360, top: 140, bold: true },
  { text: 'Tax', x: 0, right: 450, top: 140, bold: true },
  { text: 'Total', x: 0, right: RIGHT, top: 140, bold: true },
  { text: 'Adult', x: 40, top: 158 },
  { text: '$1,234.56', x: 0, right: 360, top: 158 },
  { text: '$65.44', x: 0, right: 450, top: 158 },
  { text: '$1,300.00', x: 0, right: RIGHT, top: 158 },
  { text: 'Child', x: 40, top: 174 },
  { text: '$1,234.56', x: 0, right: 360, top: 174 },
  { text: '$65.44', x: 0, right: 450, top: 174 },
  { text: '$1,300.00', x: 0, right: RIGHT, top: 174 },
  { text: 'Subtotal', x: 40, top: 204 },
  { text: '$2,600.00', x: 0, right: RIGHT, top: 204 },
  { text: 'Service charge 10% included', x: 40, top: 220, size: 9 },
  { text: 'Discount', x: 40, top: 236 },
  { text: '($100.00)', x: 0, right: RIGHT, top: 236 },
  { text: 'Total Price', x: 40, top: 262, size: 16, bold: true },
  { text: '$2,500.00', x: 0, right: RIGHT, top: 262, size: 16, bold: true, color: GREEN },
  { text: 'Surcharge (GBP)', x: 40, top: 290, size: 9 },
  { text: '£12.50', x: 0, right: RIGHT, top: 290, size: 9 },
  { text: 'Amount Paid (EUR)', x: 40, top: 306, size: 9 },
  { text: '2.300,50 €', x: 0, right: RIGHT, top: 306, size: 9 },
]

/**
 * Three pages: an e-ticket, an invoice table, and an image-only (scanned) page.
 * Standard fonts only, so the PDF has no embedded font programs.
 */
export async function createPriceSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const times = await doc.embedFont(StandardFonts.TimesRoman)
  const timesBold = await doc.embedFont(StandardFonts.TimesRomanBold)

  draw(doc.addPage([612, 792]), TICKET_CELLS, helvetica, helveticaBold)

  const invoice = doc.addPage([612, 792])
  draw(invoice, INVOICE_CELLS, times, timesBold)
  invoice.drawText('Refund fee USD 99.00', {
    x: 590,
    y: 400,
    size: 9,
    font: times,
    color: INK,
    rotate: degrees(90),
  })

  const scanned = doc.addPage([612, 792])
  scanned.drawImage(await doc.embedPng(PNG_1PX), { x: 0, y: 0, width: 612, height: 792 })

  return doc.save()
}
