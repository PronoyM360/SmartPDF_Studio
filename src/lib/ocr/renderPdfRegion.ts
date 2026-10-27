import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RgbaImage } from '@/lib/ocr/backgroundRepair'
import { createPageDisplayTransform, type PageDisplayTransform } from '@/lib/pdf'
import type { PageRect } from '@/types'

/** Density used for vector pages, where there is no scan resolution to match. */
export const VECTOR_REGION_PIXELS_PER_POINT = 4
const MIN_PIXELS_PER_POINT = 1
const MAX_PIXELS_PER_POINT = 8
const MAX_REGION_PIXELS = 6_000_000

/**
 * Patches are rendered at the scan's own density so they are neither upscaled nor
 * softer than the pixels around them.
 */
export function choosePatchPixelsPerPoint(nativePixelsPerPoint: number | null): number {
  if (!nativePixelsPerPoint || !Number.isFinite(nativePixelsPerPoint)) {
    return VECTOR_REGION_PIXELS_PER_POINT
  }
  return Math.min(MAX_PIXELS_PER_POINT, Math.max(MIN_PIXELS_PER_POINT, nativePixelsPerPoint))
}

export interface RenderedRegion {
  readonly image: RgbaImage
  readonly pixelsPerPoint: number
  /** Display-space box (points at scale 1, top-left origin) covered by `image`. */
  readonly displayBox: PageRect
  /** Scale-1 transform for converting between display points and PDF user space. */
  readonly baseTransform: PageDisplayTransform
}

export async function getBaseDisplayTransform(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PageDisplayTransform> {
  const page = await pdf.getPage(pageIndex + 1)
  return createPageDisplayTransform(pageIndex, page.getViewport({ scale: 1 }))
}

/** Renders only `displayBox` of a page (clamped to the page) and reads its pixels. */
export async function renderPdfRegion(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  displayBox: PageRect,
  requestedPixelsPerPoint: number,
): Promise<RenderedRegion> {
  const page = await pdf.getPage(pageIndex + 1)
  const baseViewport = page.getViewport({ scale: 1 })
  const baseTransform = createPageDisplayTransform(pageIndex, baseViewport)
  const x = Math.max(0, displayBox.x)
  const y = Math.max(0, displayBox.y)
  const box: PageRect = {
    x,
    y,
    width: Math.max(1, Math.min(baseViewport.width, displayBox.x + displayBox.width) - x),
    height: Math.max(1, Math.min(baseViewport.height, displayBox.y + displayBox.height) - y),
  }

  let scale = requestedPixelsPerPoint
  const pixels = box.width * box.height * scale * scale
  if (pixels > MAX_REGION_PIXELS) {
    scale *= Math.sqrt(MAX_REGION_PIXELS / pixels)
  }
  const viewport = page.getViewport({ scale, offsetX: -box.x * scale, offsetY: -box.y * scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(box.width * scale))
  canvas.height = Math.max(1, Math.round(box.height * scale))
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Could not create a canvas to inspect the region.')
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport, canvas }).promise
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    return {
      image: { data: imageData.data, width: imageData.width, height: imageData.height },
      pixelsPerPoint: canvas.width / box.width,
      displayBox: box,
      baseTransform,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function rgbaToPngBytes(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  crop?: { x: number; y: number; width: number; height: number },
): Promise<Uint8Array> {
  const region = crop ?? { x: 0, y: 0, width, height }
  const canvas = document.createElement('canvas')
  canvas.width = region.width
  canvas.height = region.height
  try {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not encode the repaired region.')
    }
    const full = new ImageData(new Uint8ClampedArray(pixels), width, height)
    context.putImageData(full, -region.x, -region.y)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      throw new Error('Could not encode the repaired region.')
    }
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
