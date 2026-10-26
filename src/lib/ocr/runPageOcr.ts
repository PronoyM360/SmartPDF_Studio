import { acquireOcrWorker, cancelOcrWorker } from '@/lib/ocr/ocrWorkerPool'
import { parseOcrPageToItems } from '@/lib/ocr/parseOcrWords'
import { renderPageBitmapForOcr } from '@/lib/ocr/renderPageForOcr'
import type { OcrLanguagePackId, OcrPageResult } from '@/types/ocr'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PageRect } from '@/types'

export interface RunPageOcrOptions {
  pdf: PDFDocumentProxy
  pageIndex: number
  languageId: OcrLanguagePackId
  regionBounds?: PageRect | null
  onPhase?: (phase: 'rendering' | 'loading-worker' | 'recognizing', message: string) => void
  onProgress?: (progress: number, status: string) => void
  isCancelled?: () => boolean
}

export async function runPageOcr(
  options: RunPageOcrOptions,
): Promise<OcrPageResult> {
  const {
    pdf,
    pageIndex,
    languageId,
    regionBounds = null,
    onPhase,
    onProgress,
    isCancelled,
  } = options

  onPhase?.('rendering', 'Rendering page for OCR…')
  const bitmap = await renderPageBitmapForOcr(pdf, pageIndex, {
    cropPdfRect: regionBounds,
  })

  if (isCancelled?.()) {
    throw new OcrCancelledError()
  }

  onPhase?.('loading-worker', 'Loading OCR engine…')
  const worker = await acquireOcrWorker(languageId, (progress, status) => {
    onProgress?.(progress, status)
  })

  if (isCancelled?.()) {
    throw new OcrCancelledError()
  }

  onPhase?.('recognizing', 'Recognizing text…')
  let pageData
  try {
    pageData = await worker.recognize(bitmap.canvas)
  } catch (cause) {
    if (isCancelled?.()) {
      throw new OcrCancelledError()
    }
    throw cause
  }

  if (isCancelled?.()) {
    throw new OcrCancelledError()
  }

  const items = parseOcrPageToItems(
    pageData,
    pageIndex,
    bitmap.displayTransform,
    { x: bitmap.offsetX, y: bitmap.offsetY },
  )

  return {
    pageIndex,
    languageId,
    items,
    ranAt: Date.now(),
    regionBounds,
  }
}

export class OcrCancelledError extends Error {
  constructor() {
    super('OCR cancelled.')
    this.name = 'OcrCancelledError'
  }
}

export { cancelOcrWorker }
