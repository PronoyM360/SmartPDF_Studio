import { computeOcrRenderScale } from '@/lib/ocr/computeOcrRenderScale'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  createPageDisplayTransform,
  pdfRectToScreenRect,
  renderPdfPage,
  type PageDisplayTransform,
} from '@/lib/pdf'
import type { PageRect } from '@/types'

export const DEFAULT_OCR_RENDER_SCALE = 2.5

export interface OcrPageBitmap {
  readonly canvas: HTMLCanvasElement
  readonly offsetX: number
  readonly offsetY: number
  readonly displayTransform: PageDisplayTransform
}

export async function renderPageBitmapForOcr(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  options: {
    scale?: number
    cropPdfRect?: PageRect | null
  } = {},
): Promise<OcrPageBitmap> {
  const page = await pdf.getPage(pageIndex + 1)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale =
    options.scale ??
    computeOcrRenderScale({
      cropPdfRect: options.cropPdfRect ?? null,
      pageWidthPt: baseViewport.width,
      pageHeightPt: baseViewport.height,
    })
  const viewport = page.getViewport({ scale })
  const displayTransform = createPageDisplayTransform(pageIndex, viewport)

  const fullCanvas = document.createElement('canvas')
  await renderPdfPage({
    page,
    canvas: fullCanvas,
    scale,
    devicePixelRatio: 1,
  }).promise

  const cropPdfRect = options.cropPdfRect
  if (!cropPdfRect) {
    return {
      canvas: fullCanvas,
      offsetX: 0,
      offsetY: 0,
      displayTransform,
    }
  }

  const cropScreen = pdfRectToScreenRect(displayTransform, cropPdfRect)
  const cropWidth = Math.max(1, Math.floor(cropScreen.width))
  const cropHeight = Math.max(1, Math.floor(cropScreen.height))
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropWidth
  cropCanvas.height = cropHeight
  const context = cropCanvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create OCR crop canvas.')
  }
  context.drawImage(
    fullCanvas,
    Math.floor(cropScreen.x),
    Math.floor(cropScreen.y),
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  )

  return {
    canvas: cropCanvas,
    offsetX: cropScreen.x,
    offsetY: cropScreen.y,
    displayTransform,
  }
}
