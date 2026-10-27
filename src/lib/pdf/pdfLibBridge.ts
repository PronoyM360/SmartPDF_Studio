import { EncryptedPDFError, PDFDocument } from 'pdf-lib'
import type { PdfSource } from '@/types'

export class PdfLibLoadError extends Error {
  readonly encrypted: boolean

  constructor(message: string, encrypted: boolean) {
    super(message)
    this.name = 'PdfLibLoadError'
    this.encrypted = encrypted
  }
}

/**
 * Loads a pdf-lib document from a copy of the immutable source bytes.
 * `updateMetadata: false` keeps pdf-lib from stamping its own producer and dates.
 */
export async function loadPdfLibDocument(
  source: PdfSource,
  options: { updateMetadata?: boolean } = {},
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(source.originalBytes.slice(), {
      updateMetadata: options.updateMetadata ?? true,
    })
  } catch (cause) {
    // pdf-lib's errors are compiled to ES5, where `instanceof` on Error subclasses fails.
    const encrypted =
      cause instanceof EncryptedPDFError ||
      (cause instanceof Error && /\bis encrypted\b/i.test(cause.message))
    if (encrypted) {
      throw new PdfLibLoadError(
        'This PDF is encrypted (password or permission protection). pdf-lib cannot decrypt or re-encrypt files, so an edited copy cannot be saved safely. Remove the protection with an authorised tool first.',
        true,
      )
    }
    throw new PdfLibLoadError(
      `The original PDF could not be read for export${cause instanceof Error ? `: ${cause.message}` : '.'}`,
      false,
    )
  }
}
