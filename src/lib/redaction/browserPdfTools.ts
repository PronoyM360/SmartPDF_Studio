import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { openPdfDocument } from '@/lib/pdf/openPdfDocument'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import type { PageRect } from '@/types'
import type { OpenPdfInspector, PdfInspector, RedactionArea } from './types'

/** ~180 DPI, capped so very large pages stay within canvas limits. */
const RASTER_SCALE = 2.5
const MAX_RASTER_SIDE_PX = 4000
const COVERAGE_SCALE = 1.5
const COVERAGE_TOLERANCE = 48

function viewportRect(viewport: PageViewport, rect: PageRect): PageRect {
  const corners = [
    viewport.convertToViewportPoint(rect.x, rect.y),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y),
    viewport.convertToViewportPoint(rect.x, rect.y + rect.height),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map((point) => point[0] ?? 0)
  const ys = corners.map((point) => point[1] ?? 0)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

async function renderToCanvas(
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is not available.')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport, canvas }).promise
  return canvas
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const body = normalizeHexForColorInput(hex, '#000000').slice(1)
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ]
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('Could not encode page image.'))),
      'image/png',
    ),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

function paintAreas(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  areas: readonly RedactionArea[],
): void {
  const context = canvas.getContext('2d')!
  for (const area of areas) {
    const rect = viewportRect(viewport, area.bounds)
    context.fillStyle = area.fillColor
    // Expand to whole pixels so anti-aliased glyph edges at the border are covered.
    const x = Math.floor(rect.x) - 1
    const y = Math.floor(rect.y) - 1
    context.fillRect(x, y, Math.ceil(rect.x + rect.width) + 1 - x, Math.ceil(rect.y + rect.height) + 1 - y)
  }
}

/** PDF.js + canvas implementation used by export in the browser. */
export const openBrowserInspector: OpenPdfInspector = async (bytes) => {
  const { pdf } = await openPdfDocument(bytes)
  const coverageCanvases = new Map<number, { canvas: HTMLCanvasElement; viewport: PageViewport }>()

  const inspector: PdfInspector = {
    pageCount: pdf.numPages,
    async readPageText(pageIndex) {
      const items = await extractPageTextItems(pdf, pageIndex)
      return items.map((item) => ({ text: item.text, bounds: item.bounds }))
    },
    async rasterizeWithRedactions(pageIndex, areas) {
      const page = await pdf.getPage(pageIndex + 1)
      const base = page.getViewport({ scale: 1, rotation: 0 })
      const scale = Math.min(RASTER_SCALE, MAX_RASTER_SIDE_PX / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale, rotation: 0 })
      const canvas = await renderToCanvas(page, viewport)
      try {
        paintAreas(canvas, viewport, areas)
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
        return {
          png: await canvasToPng(canvas),
          visibleBox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        }
      } finally {
        releaseCanvas(canvas)
      }
    },
    async measureFillCoverage(pageIndex, rect, fillColor) {
      let entry = coverageCanvases.get(pageIndex)
      if (!entry) {
        const page = await pdf.getPage(pageIndex + 1)
        const viewport = page.getViewport({ scale: COVERAGE_SCALE, rotation: 0 })
        entry = { canvas: await renderToCanvas(page, viewport), viewport }
        coverageCanvases.set(pageIndex, entry)
      }
      const area = viewportRect(entry.viewport, rect)
      const inset = 2
      const x = Math.max(0, Math.ceil(area.x + inset))
      const y = Math.max(0, Math.ceil(area.y + inset))
      const width = Math.min(entry.canvas.width - x, Math.floor(area.width - inset * 2))
      const height = Math.min(entry.canvas.height - y, Math.floor(area.height - inset * 2))
      if (width <= 0 || height <= 0) {
        return null
      }
      const data = entry.canvas.getContext('2d')!.getImageData(x, y, width, height).data
      const [r, g, b] = hexToRgbTuple(fillColor)
      let matching = 0
      for (let index = 0; index < data.length; index += 4) {
        const distance = Math.hypot(
          (data[index] ?? 0) - r,
          (data[index + 1] ?? 0) - g,
          (data[index + 2] ?? 0) - b,
        )
        if (distance <= COVERAGE_TOLERANCE) {
          matching += 1
        }
      }
      return matching / (data.length / 4)
    },
    async destroy() {
      for (const { canvas } of coverageCanvases.values()) {
        releaseCanvas(canvas)
      }
      coverageCanvases.clear()
      await pdf.loadingTask.destroy()
    },
  }
  return inspector
}

export type BackgroundKind = 'solid' | 'complex'

export interface RegionAnalysis {
  readonly background: BackgroundKind
  /** Mean colour of the band just outside the region. */
  readonly surroundingColor: string
  /** 90th-percentile colour distance from the mean in that band (0 = perfectly flat). */
  readonly spread: number
  readonly beforeUrl: string
  /** Renders the same crop with the region filled. */
  readonly previewWithFill: (fillColor: string) => string
  readonly release: () => void
}

const SOLID_SPREAD_LIMIT = 18
const PREVIEW_SCALE = 2
const PREVIEW_PADDING_PT = 14

function toHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
}

/**
 * Renders the page as the user sees it (including rotation) and inspects the band
 * around a region: a flat band means a matching cover will blend in, a varied band
 * (gradients, photos, patterns) means any flat box will be noticeable.
 */
export async function analyzeRegion(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  bounds: PageRect,
): Promise<RegionAnalysis> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: PREVIEW_SCALE })
  const full = await renderToCanvas(page, viewport)
  try {
    const region = viewportRect(viewport, bounds)
    const context = full.getContext('2d', { willReadFrequently: true })!

    const ringInner = 3
    const ringOuter = 9
    const ox = Math.max(0, Math.floor(region.x - ringOuter))
    const oy = Math.max(0, Math.floor(region.y - ringOuter))
    const ow = Math.min(full.width, Math.ceil(region.x + region.width + ringOuter)) - ox
    const oh = Math.min(full.height, Math.ceil(region.y + region.height + ringOuter)) - oy
    const data = context.getImageData(ox, oy, Math.max(1, ow), Math.max(1, oh)).data
    const samples: [number, number, number][] = []
    for (let py = 0; py < oh; py += 1) {
      for (let px = 0; px < ow; px += 1) {
        const gx = ox + px
        const gy = oy + py
        const insideInner =
          gx >= region.x - ringInner &&
          gx <= region.x + region.width + ringInner &&
          gy >= region.y - ringInner &&
          gy <= region.y + region.height + ringInner
        if (insideInner) {
          continue
        }
        const offset = (py * ow + px) * 4
        samples.push([data[offset] ?? 255, data[offset + 1] ?? 255, data[offset + 2] ?? 255])
      }
    }
    const count = Math.max(samples.length, 1)
    const mean = samples.reduce<[number, number, number]>(
      (sum, sample) => [sum[0] + sample[0], sum[1] + sample[1], sum[2] + sample[2]],
      [0, 0, 0],
    ).map((value) => value / count) as [number, number, number]
    const distances = samples
      .map((sample) => Math.hypot(sample[0] - mean[0], sample[1] - mean[1], sample[2] - mean[2]))
      .sort((a, b) => a - b)
    const spread = distances[Math.floor(distances.length * 0.9)] ?? 0

    const pad = PREVIEW_PADDING_PT * PREVIEW_SCALE
    const cx = Math.max(0, Math.floor(region.x - pad))
    const cy = Math.max(0, Math.floor(region.y - pad))
    const cw = Math.min(full.width, Math.ceil(region.x + region.width + pad)) - cx
    const ch = Math.min(full.height, Math.ceil(region.y + region.height + pad)) - cy
    const crop = document.createElement('canvas')
    crop.width = Math.max(1, cw)
    crop.height = Math.max(1, ch)
    crop.getContext('2d')!.drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch)
    const beforeUrl = crop.toDataURL('image/png')

    return {
      background: spread <= SOLID_SPREAD_LIMIT ? 'solid' : 'complex',
      surroundingColor: `#${toHex(mean[0])}${toHex(mean[1])}${toHex(mean[2])}`,
      spread,
      beforeUrl,
      previewWithFill: (fillColor) => {
        const after = document.createElement('canvas')
        after.width = crop.width
        after.height = crop.height
        const afterContext = after.getContext('2d')!
        afterContext.drawImage(crop, 0, 0)
        afterContext.fillStyle = fillColor
        afterContext.fillRect(region.x - cx, region.y - cy, region.width, region.height)
        const url = after.toDataURL('image/png')
        releaseCanvas(after)
        return url
      },
      release: () => releaseCanvas(crop),
    }
  } finally {
    releaseCanvas(full)
  }
}
