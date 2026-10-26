import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/** Builds a small PDF with green price text for manual / integration testing. */
export async function createGreenPriceSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawText('5784', {
    x: 420,
    y: 680,
    size: 18,
    font,
    color: rgb(0.09, 0.64, 0.29),
  })
  page.drawText('Price', {
    x: 360,
    y: 680,
    size: 12,
    font: await doc.embedFont(StandardFonts.Helvetica),
    color: rgb(0.1, 0.1, 0.1),
  })
  return doc.save()
}
