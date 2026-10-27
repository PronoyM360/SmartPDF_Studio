import { degrees, PDFDocument } from 'pdf-lib'
import { rotatedImagePlacement } from '@/lib/pdf/export/rotationFrame'

/**
 * Browser-only fixtures: tickets drawn on a canvas and embedded as JPEG "scans", for
 * manual and automated checks of OCR-assisted editing.
 */
export type ScannedFixtureKind =
  | 'high-res-ticket'
  | 'low-res-ticket'
  | 'colored-ticket'
  | 'photo-background'
  | 'rotated-ticket'

interface TicketStyle {
  readonly dpi: number
  readonly paper: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  readonly ink: string
}

const PAGE_PT = { width: 288, height: 432 }

function noise(x: number, y: number): number {
  return ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1
}

function paperGrain(ctx: CanvasRenderingContext2D, width: number, height: number, base: [number, number, number], amount: number): void {
  const image = ctx.createImageData(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const n = (noise(x, y) - 0.5) * amount
      const offset = (y * width + x) * 4
      image.data[offset] = base[0] + n
      image.data[offset + 1] = base[1] + n
      image.data[offset + 2] = base[2] + n
      image.data[offset + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

function photo(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#1e3a8a')
  gradient.addColorStop(0.5, '#0ea5e9')
  gradient.addColorStop(1, '#f59e0b')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
  const image = ctx.getImageData(0, 0, width, height)
  for (let index = 0; index < image.data.length; index += 4) {
    const x = (index / 4) % width
    const y = Math.floor(index / 4 / width)
    const n = (noise(x * 0.7, y * 0.7) - 0.5) * 36 + Math.sin(x / 23) * 10 + Math.cos(y / 17) * 10
    image.data[index] = image.data[index]! + n
    image.data[index + 1] = image.data[index + 1]! + n
    image.data[index + 2] = image.data[index + 2]! + n
  }
  ctx.putImageData(image, 0, 0)
}

const STYLES: Record<ScannedFixtureKind, TicketStyle> = {
  'high-res-ticket': {
    dpi: 300,
    paper: (ctx, w, h) => paperGrain(ctx, w, h, [248, 247, 243], 10),
    ink: '#1f2937',
  },
  'low-res-ticket': {
    dpi: 96,
    paper: (ctx, w, h) => paperGrain(ctx, w, h, [244, 242, 236], 14),
    ink: '#111827',
  },
  'colored-ticket': {
    dpi: 200,
    paper: (ctx, w, h) => paperGrain(ctx, w, h, [253, 230, 138], 8),
    ink: '#7f1d1d',
  },
  'photo-background': {
    dpi: 200,
    paper: photo,
    ink: '#ffffff',
  },
  'rotated-ticket': {
    dpi: 200,
    paper: (ctx, w, h) => paperGrain(ctx, w, h, [250, 250, 250], 8),
    ink: '#0f172a',
  },
}

function drawTicket(kind: ScannedFixtureKind): HTMLCanvasElement {
  const style = STYLES[kind]
  const scale = style.dpi / 72
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(PAGE_PT.width * scale)
  canvas.height = Math.round(PAGE_PT.height * scale)
  const ctx = canvas.getContext('2d')!
  style.paper(ctx, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.fillStyle = style.ink
  ctx.strokeStyle = style.ink

  // Logo: filled circle with initials.
  ctx.beginPath()
  ctx.arc(144, 40, 18, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = kind === 'photo-background' ? '#1e3a8a' : '#ffffff'
  ctx.font = 'bold 14px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('SP', 144, 45)
  ctx.fillStyle = style.ink
  ctx.font = 'bold 16px Arial'
  ctx.fillText('CITY EXPRESS', 144, 80)
  ctx.font = '10px Arial'
  ctx.fillText('Ticket No. 004512', 144, 95)

  ctx.textAlign = 'left'
  ctx.font = '11px Arial'
  const rows: [string, string][] = [
    ['Adult fare', '12.50'],
    ['Seat reservation', '3.00'],
    ['Booking fee', '1.25'],
  ]
  rows.forEach(([label, amount], index) => {
    const y = 130 + index * 20
    ctx.fillText(label, 24, y)
    ctx.textAlign = 'right'
    ctx.fillText(amount, 264, y)
    ctx.textAlign = 'left'
  })
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(24, 196)
  ctx.lineTo(264, 196)
  ctx.stroke()
  ctx.font = 'bold 13px Arial'
  ctx.fillText('TOTAL', 24, 214)
  ctx.textAlign = 'right'
  ctx.fillText('16.75', 264, 214)
  ctx.textAlign = 'left'
  ctx.font = '10px Arial'
  ctx.fillText('Date: 2026-10-27   Gate B12', 24, 240)

  // Barcode.
  for (let i = 0; i < 70; i += 1) {
    const w = (i * 7) % 3 === 0 ? 2 : 1
    if ((i * 13) % 5 !== 0) {
      ctx.fillRect(40 + i * 3, 280, w, 50)
    }
  }
  ctx.font = '9px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('0 04512 26102 7', 144, 344)
  return canvas
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) {
    throw new Error('Could not encode fixture image.')
  }
  return new Uint8Array(await blob.arrayBuffer())
}

export async function createScannedSamplePdf(
  kinds: readonly ScannedFixtureKind[] = [
    'high-res-ticket',
    'low-res-ticket',
    'colored-ticket',
    'photo-background',
    'rotated-ticket',
  ],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const kind of kinds) {
    const canvas = drawTicket(kind)
    const jpeg = await doc.embedJpg(await canvasToJpeg(canvas, kind === 'low-res-ticket' ? 0.6 : 0.88))
    canvas.width = 0
    canvas.height = 0
    if (kind === 'rotated-ticket') {
      // Stored landscape with /Rotate 90, displayed as the upright ticket.
      const page = doc.addPage([PAGE_PT.height, PAGE_PT.width])
      page.setRotation(degrees(90))
      const placement = rotatedImagePlacement({ x: 0, y: 0, width: PAGE_PT.height, height: PAGE_PT.width }, 90)
      page.drawImage(jpeg, {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotate: degrees(placement.rotateDegrees),
      })
      continue
    }
    const page = doc.addPage([PAGE_PT.width, PAGE_PT.height])
    page.drawImage(jpeg, { x: 0, y: 0, width: PAGE_PT.width, height: PAGE_PT.height })
  }
  return doc.save()
}
