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
  /** Also return one item per recognised line (in addition to words). */
  includeLines?: boolean
  /** Effective resolution of the page's scan, so OCR never renders below it. */
  nativePixelsPerPoint?: number | null
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
    nativePixelsPerPoint: options.nativePixelsPerPoint ?? null,
  })

  try {
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
    let stopPolling = (): void => undefined
    // A terminated worker may never settle its job, so cancellation also ends the wait.
    const cancelled = new Promise<never>((_, reject) => {
      const timer = window.setInterval(() => {
        if (isCancelled?.()) {
          window.clearInterval(timer)
          reject(new OcrCancelledError())
        }
      }, 150)
      stopPolling = () => window.clearInterval(timer)
    })
    try {
      pageData = await Promise.race([worker.recognize(bitmap.canvas), cancelled])
    } catch (cause) {
      if (isCancelled?.()) {
        throw new OcrCancelledError()
      }
      throw cause
    } finally {
      stopPolling()
    }

    if (isCancelled?.()) {
      throw new OcrCancelledError()
    }

    const items = parseOcrPageToItems(
      pageData,
      pageIndex,
      bitmap.displayTransform,
      { x: bitmap.offsetX, y: bitmap.offsetY },
      { includeLines: options.includeLines },
    )

    return {
      pageIndex,
      languageId,
      items,
      ranAt: Date.now(),
      regionBounds,
    }
  } finally {
    bitmap.release()
  }
}

export class OcrCancelledError extends Error {
  constructor() {
    super('OCR cancelled.')
    this.name = 'OcrCancelledError'
  }
}

export { cancelOcrWorker }
