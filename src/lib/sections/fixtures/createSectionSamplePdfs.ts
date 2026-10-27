import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

interface Line {
  text: string
  x: number
  /** Distance from the top of the page, in points. */
  top: number
  size?: number
  bold?: boolean
}

const TICKET_LINES: readonly Line[] = [
  { text: 'ELECTRONIC TICKET RECEIPT', x: 40, top: 50, size: 18, bold: true },
  { text: 'PASSENGER INFORMATION', x: 40, top: 100, size: 11, bold: true },
  { text: 'Name: MR JOHN DOE', x: 40, top: 118 },
  { text: 'Passport: X1234567', x: 40, top: 132 },
  { text: 'BOOKING DETAILS', x: 340, top: 100, size: 11, bold: true },
  { text: 'PNR: AB12CD', x: 340, top: 118 },
  { text: 'Issued: 12 JAN 2026', x: 340, top: 132 },
  { text: 'FLIGHT DETAILS', x: 40, top: 190, size: 11, bold: true },
  { text: 'BG 147', x: 40, top: 220 },
  { text: 'DAC 10:30', x: 160, top: 220 },
  { text: 'CXB 11:35', x: 300, top: 220 },
  { text: 'Economy', x: 440, top: 220 },
  { text: 'Base Fare', x: 40, top: 290 },
  { text: 'USD 120.00', x: 420, top: 290 },
  { text: 'Taxes & Surcharges', x: 40, top: 304 },
  { text: 'USD 35.50', x: 420, top: 304 },
  { text: 'Total Price', x: 40, top: 320, size: 11, bold: true },
  { text: 'USD 155.50', x: 420, top: 320, size: 11, bold: true },
  { text: 'AGENCY CONTACT', x: 40, top: 380, size: 11, bold: true },
  { text: 'Skyline Travels Ltd · IATA 12345678', x: 40, top: 398 },
  { text: 'support@skyline.example · +880 1700 000000', x: 40, top: 412 },
]

const ROTATED_LINES: readonly Line[] = [
  { text: 'BAGGAGE ALLOWANCE', x: 40, top: 60, size: 11, bold: true },
  { text: 'Checked: 20 KG', x: 40, top: 78 },
  { text: 'Cabin: 7 KG', x: 40, top: 92 },
  { text: 'TERMS AND CONDITIONS', x: 40, top: 150, size: 11, bold: true },
  { text: 'Tickets are non-refundable after departure and subject to fare rules.', x: 40, top: 168, size: 9 },
  { text: 'Changes must be made 24 hours before departure.', x: 40, top: 180, size: 9 },
]

const PLAIN_LINES: readonly Line[] = [
  { text: 'The quarterly garden club meeting will take place in the hall.', x: 40, top: 60 },
  { text: 'Bring seeds for the exchange table and a packed lunch.', x: 40, top: 74 },
  { text: 'Weather permitting we will walk the north meadow afterwards.', x: 40, top: 160 },
]

function drawLines(page: PDFPage, lines: readonly Line[], font: PDFFont, bold: PDFFont): void {
  const height = page.getHeight()
  for (const line of lines) {
    const size = line.size ?? 10
    page.drawText(line.text, {
      x: line.x,
      y: height - line.top - size,
      size,
      font: line.bold ? bold : font,
      color: rgb(0.1, 0.1, 0.12),
    })
  }
}

/** Three pages: ticket layout, a 90°-rotated page, and a page without section headings. */
export async function createTicketSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  drawLines(doc.addPage([612, 792]), TICKET_LINES, font, bold)
  const rotated = doc.addPage([612, 792])
  rotated.setRotation(degrees(90))
  drawLines(rotated, ROTATED_LINES, font, bold)
  drawLines(doc.addPage([612, 792]), PLAIN_LINES, font, bold)

  return doc.save()
}

/**
 * Two pages for hide/cover/redact testing: contact details on a solid tinted band,
 * agency details on a striped (busy) background, and the email repeated on page 2.
 */
export async function createStyledTicketSamplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage([612, 792])
  const height = page.getHeight()

  page.drawRectangle({ x: 30, y: height - 175, width: 330, height: 80, color: rgb(0.86, 0.92, 0.99) })
  for (let index = 0; index < 40; index += 1) {
    const shade = index % 2 === 0 ? rgb(0.98, 0.85, 0.6) : rgb(0.75, 0.88, 0.7)
    page.drawRectangle({ x: 30 + index * 9, y: height - 300, width: 9, height: 90, color: shade })
  }

  drawLines(
    page,
    [
      { text: 'ELECTRONIC TICKET RECEIPT', x: 40, top: 50, size: 18, bold: true },
      { text: 'CONTACT INFORMATION', x: 40, top: 105, size: 11, bold: true },
      { text: 'Email: support@skyline.example', x: 40, top: 123 },
      { text: 'Phone: +880 1700 000000', x: 40, top: 137 },
      { text: 'Address: 12 Lake Road, Dhaka', x: 40, top: 151 },
      { text: 'AGENCY DETAILS', x: 40, top: 220, size: 11, bold: true },
      { text: 'Skyline Travels Ltd · IATA 12345678', x: 40, top: 238 },
      { text: 'Agent: Rahim Uddin', x: 40, top: 252 },
      { text: 'FLIGHT DETAILS', x: 40, top: 340, size: 11, bold: true },
      { text: 'BG 147  DAC 10:30  CXB 11:35', x: 40, top: 358 },
    ],
    font,
    bold,
  )

  drawLines(
    doc.addPage([612, 792]),
    [
      { text: 'TERMS AND CONDITIONS', x: 40, top: 60, size: 11, bold: true },
      { text: 'Tickets are non-refundable after departure.', x: 40, top: 78 },
      { text: 'Questions? support@skyline.example', x: 40, top: 100 },
    ],
    font,
    bold,
  )
  return doc.save()
}

/** Browser only: rasterizes the ticket into a page-sized image so it has no selectable text. */
export async function createScannedTicketSamplePdf(): Promise<Uint8Array> {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = 612 * scale
  canvas.height = 792 * scale
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is not available.')
  }
  context.fillStyle = '#fbfaf7'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#1a1a1f'
  context.textBaseline = 'top'
  for (const line of TICKET_LINES) {
    const size = (line.size ?? 10) * scale
    context.font = `${line.bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`
    context.fillText(line.text, line.x * scale, line.top * scale)
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encode failed.'))), 'image/png'),
  )
  canvas.width = 0
  canvas.height = 0

  const doc = await PDFDocument.create()
  const image = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()))
  const page = doc.addPage([612, 792])
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 })
  return doc.save()
}
