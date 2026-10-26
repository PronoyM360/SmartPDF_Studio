import { PDFDocument } from 'pdf-lib'
import type { PdfSource } from '@/types'

/** Loads a pdf-lib document from immutable source bytes (for future export/edit steps). */
export async function loadPdfLibDocument(source: PdfSource): Promise<PDFDocument> {
  return PDFDocument.load(source.originalBytes.slice())
}
