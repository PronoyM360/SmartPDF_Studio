import { computeOcrRenderScale } from '@/lib/ocr/computeOcrRenderScale'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  createPageDisplayTransform,
  pdfRectToScreenBounds,
  type PageDisplayTransform,
} from '@/lib/pdf'
import type { PageRect } from '@/types'

export const DEFAULT_OCR_RENDER_SCALE = 2.5
/** Keeps OCR canvases well below browser canvas limits on large pages. */
export const MAX_OCR_CANVAS_PIXELS = 24_000_000

export interface OcrPageBitmap {
  readonly canvas: HTMLCanvasElement
  readonly offsetX: number
  readonly offsetY: number
  readonly displayTransform: PageDisplayTransform
  /** Frees the canvas backing store and PDF.js page resources. */
  readonly release: () => void
}

/** Display-space box (scale 1) of the crop, clamped to the page. */
function cropDisplayBox(
  baseTransform: PageDisplayTransform,
  cropPdfRect: PageRect | null,
): PageRect {
  const page = { x: 0, y: 0, width: baseTransform.cssWidth, height: baseTransform.cssHeight }
  if (!cropPdfRect) {
    return page
  }
  const box = pdfRectToScreenBounds(baseTransform, cropPdfRect)
  const x = Math.max(0, box.x)
  const y = Math.max(0, box.y)
  return {
    x,
    y,
    width: Math.max(1, Math.min(page.width, box.x + box.width) - x),
    height: Math.max(1, Math.min(page.height, box.y + box.height) - y),
  }
}

/**
 * Renders the page (or only the cropped region) for OCR. The returned display
 * transform maps canvas pixels straight to PDF user space, rotation included.
 */
export async function renderPageBitmapForOcr(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  options: {
    scale?: number
    cropPdfRect?: PageRect | null
    nativePixelsPerPoint?: number | null
  } = {},
): Promise<OcrPageBitmap> {
  const page = await pdf.getPage(pageIndex + 1)
  const baseViewport = page.getViewport({ scale: 1 })
  const baseTransform = createPageDisplayTransform(pageIndex, baseViewport)
  const crop = cropDisplayBox(baseTransform, options.cropPdfRect ?? null)

  let scale =
    options.scale ??
    computeOcrRenderScale({
      cropPdfRect: options.cropPdfRect ?? null,
      pageWidthPt: baseViewport.width,
      pageHeightPt: baseViewport.height,
      nativePixelsPerPoint: options.nativePixelsPerPoint ?? null,
    })
  const pixels = crop.width * crop.height * scale * scale
  if (pixels > MAX_OCR_CANVAS_PIXELS) {
    scale *= Math.sqrt(MAX_OCR_CANVAS_PIXELS / pixels)
  }

  const viewport = page.getViewport({
    scale,
    offsetX: -crop.x * scale,
    offsetY: -crop.y * scale,
  })
  const displayTransform = createPageDisplayTransform(pageIndex, viewport)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(crop.width * scale))
  canvas.height = Math.max(1, Math.ceil(crop.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create OCR canvas.')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport, canvas }).promise

  return {
    canvas,
    offsetX: 0,
    offsetY: 0,
    displayTransform,
    release: () => {
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    },
  }
}
