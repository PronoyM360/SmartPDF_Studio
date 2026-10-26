import { PDF_MAX_FILE_SIZE_BYTES, PDF_ACCEPT_EXTENSION } from './uploadConfig'
import { PdfUserFacingError } from './pdfErrors'

const PDF_SIGNATURE = '%PDF-'

function hasPdfExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(PDF_ACCEPT_EXTENSION)
}

function hasAllowedMimeType(file: File): boolean {
  if (!file.type) {
    return true
  }
  const normalized = file.type.toLowerCase()
  return normalized === 'application/pdf' || normalized === 'application/x-pdf'
}

function readPdfSignature(bytes: Uint8Array): string {
  const length = Math.min(bytes.byteLength, 5)
  let header = ''
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[index]
    if (byte === undefined) {
      break
    }
    header += String.fromCharCode(byte)
  }
  return header
}

export async function validatePdfFile(file: File): Promise<void> {
  if (!file) {
    throw new PdfUserFacingError('No file was selected.')
  }
  if (file.size === 0) {
    throw new PdfUserFacingError('This file is empty.')
  }
  if (file.size > PDF_MAX_FILE_SIZE_BYTES) {
    const limitMb = Math.round(PDF_MAX_FILE_SIZE_BYTES / (1024 * 1024))
    throw new PdfUserFacingError(
      `This PDF exceeds the ${limitMb} MB upload limit.`,
    )
  }
  if (!hasPdfExtension(file.name)) {
    throw new PdfUserFacingError('Only .pdf files are supported.')
  }
  if (!hasAllowedMimeType(file)) {
    throw new PdfUserFacingError('Only PDF documents are supported.')
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength === 0) {
    throw new PdfUserFacingError('This file is empty.')
  }
  if (!readPdfSignature(bytes).startsWith(PDF_SIGNATURE)) {
    throw new PdfUserFacingError(
      'The file does not appear to be a valid PDF document.',
    )
  }
}
