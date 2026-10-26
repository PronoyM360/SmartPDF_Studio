import { GlobalWorkerOptions } from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let configured = false

/** Must run once before any PDF.js APIs (typically at app startup). */
export function configurePdfJsWorker(): void {
  if (configured) {
    return
  }
  GlobalWorkerOptions.workerSrc = pdfjsWorker
  configured = true
}
