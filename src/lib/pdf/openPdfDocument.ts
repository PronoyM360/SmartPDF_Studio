import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { toUserFacingPdfError } from './pdfErrors'

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice()
}

export interface OpenPdfDocumentResult {
  pdf: PDFDocumentProxy
  pageCount: number
}

export async function openPdfDocument(
  originalBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<OpenPdfDocumentResult> {
  const loadingTask = getDocument({ data: cloneBytes(originalBytes) })

  const abortLoad = (): void => {
    loadingTask.destroy()
  }

  if (signal) {
    if (signal.aborted) {
      abortLoad()
      throw toUserFacingPdfError(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abortLoad, { once: true })
  }

  try {
    const pdf = await loadingTask.promise
    if (signal?.aborted) {
      await loadingTask.destroy()
      throw toUserFacingPdfError(new DOMException('Aborted', 'AbortError'))
    }
    return { pdf, pageCount: pdf.numPages }
  } catch (cause) {
    abortLoad()
    throw toUserFacingPdfError(cause)
  }
}

/** Destroys the document and its loading task; `cleanup()` alone keeps the worker-side copy alive. */
export async function releasePdfDocument(pdf: PDFDocumentProxy): Promise<void> {
  await pdf.loadingTask.destroy()
}
