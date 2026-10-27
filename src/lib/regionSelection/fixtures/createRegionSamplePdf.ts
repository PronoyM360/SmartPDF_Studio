import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { createScannedSamplePdf } from '@/lib/ocr/fixtures/createScannedSamplePdfs'

/**
 * Browser-only fixture for manual region selection: different page sizes, a 90° and a
 * 270° rotated page with selectable text, and a scanned page for OCR.
 */
export async function createRegionSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.12, 0.16)

  const letter = doc.addPage([612, 792])
  letter.drawText('Booking summary', { x: 56, y: 730, size: 20, font: bold, color: ink })
  letter.drawRectangle({ x: 56, y: 560, width: 500, height: 120, borderColor: ink, borderWidth: 0.8 })
  ;['Passenger: J. Doe', 'Seat: 14C', 'Reference: QX7-22'].forEach((line, index) => {
    letter.drawText(line, { x: 72, y: 650 - index * 24, size: 12, font, color: ink })
  })
  letter.drawText('Notes', { x: 56, y: 500, size: 13, font: bold, color: ink })
  letter.drawText('Free cancellation until 24 hours before departure.', { x: 56, y: 478, size: 10, font, color: ink })

  // Landscape content stored on a portrait page and displayed rotated by 90°.
  const rotated = doc.addPage([396, 612])
  rotated.setRotation(degrees(90))
  rotated.drawText('Rotated receipt', { x: 40, y: 560, size: 16, font: bold, color: ink, rotate: degrees(90) })
  rotated.drawText('Total due 48.20', { x: 80, y: 360, size: 12, font, color: ink, rotate: degrees(90) })

  const small = doc.addPage([420, 298])
  small.setRotation(degrees(270))
  small.drawText('Small card, rotated 270°', { x: 24, y: 250, size: 14, font: bold, color: ink })
  small.drawText('Code 5521', { x: 24, y: 220, size: 11, font, color: ink })

  const scanned = await PDFDocument.load(await createScannedSamplePdf(['high-res-ticket']))
  const [scanPage] = await doc.copyPages(scanned, [0])
  doc.addPage(scanPage!)

  return doc.save()
}
