import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createScannedSamplePdf } from '@/lib/ocr/fixtures/createScannedSamplePdfs'

/**
 * Browser-only fixture for the before/after preview: pages of different sizes with
 * selectable text, prices, a removable section and one scanned page for OCR edits.
 */
export async function createPreviewSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.12, 0.16)

  const letter = doc.addPage([612, 792])
  letter.drawText('ACME Travel Ltd.', { x: 56, y: 730, size: 20, font: bold, color: ink })
  letter.drawText('Invoice 2025-0412', { x: 56, y: 700, size: 12, font, color: ink })
  const rows: [string, string][] = [
    ['Return ticket', '84.00'],
    ['Seat reservation', '6.50'],
    ['Booking fee', '2.25'],
  ]
  rows.forEach(([label, amount], index) => {
    const y = 640 - index * 22
    letter.drawText(label, { x: 56, y, size: 12, font, color: ink })
    letter.drawText(amount, { x: 556 - font.widthOfTextAtSize(amount, 12), y, size: 12, font, color: ink })
  })
  letter.drawLine({ start: { x: 56, y: 566 }, end: { x: 556, y: 566 }, thickness: 0.8, color: ink })
  letter.drawText('Total', { x: 56, y: 546, size: 13, font: bold, color: ink })
  letter.drawText('92.75', { x: 556 - bold.widthOfTextAtSize('92.75', 13), y: 546, size: 13, font: bold, color: ink })
  letter.drawText('Terms and conditions', { x: 56, y: 470, size: 13, font: bold, color: ink })
  const terms = [
    'Tickets are valid only for the date and route shown above.',
    'Refunds are available up to 24 hours before departure.',
    'Keep this invoice as proof of purchase.',
  ]
  terms.forEach((line, index) => {
    letter.drawText(line, { x: 56, y: 448 - index * 16, size: 10, font, color: ink })
  })

  const small = doc.addPage([420, 298])
  small.drawText('Boarding pass', { x: 24, y: 260, size: 16, font: bold, color: ink })
  small.drawText('Passenger: J. Doe', { x: 24, y: 230, size: 11, font, color: ink })
  small.drawText('Fare', { x: 24, y: 200, size: 11, font, color: ink })
  small.drawText('9.99', { x: 396 - font.widthOfTextAtSize('9.99', 11), y: 200, size: 11, font, color: ink })

  const scanned = await PDFDocument.load(await createScannedSamplePdf(['high-res-ticket']))
  const [scanPage] = await doc.copyPages(scanned, [0])
  doc.addPage(scanPage!)

  return doc.save()
}
