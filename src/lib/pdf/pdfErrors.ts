import {
  InvalidPDFException,
  PasswordException,
  ResponseException,
} from 'pdfjs-dist'

export class PdfUserFacingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfUserFacingError'
  }
}

export function toUserFacingPdfError(cause: unknown): PdfUserFacingError {
  if (cause instanceof PdfUserFacingError) {
    return cause
  }
  if (cause instanceof PasswordException) {
    return new PdfUserFacingError(
      'This PDF is password-protected. Remove the password and try again.',
    )
  }
  if (cause instanceof InvalidPDFException) {
    return new PdfUserFacingError(
      'The file looks corrupted or is not a valid PDF.',
    )
  }
  if (cause instanceof ResponseException) {
    return new PdfUserFacingError('Could not read the PDF data.')
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new PdfUserFacingError('PDF loading was cancelled.')
  }
  if (cause instanceof Error) {
    const lower = cause.message.toLowerCase()
    if (lower.includes('password')) {
      return new PdfUserFacingError(
        'This PDF is password-protected. Remove the password and try again.',
      )
    }
    if (lower.includes('invalid pdf') || lower.includes('corrupt')) {
      return new PdfUserFacingError(
        'The file looks corrupted or is not a valid PDF.',
      )
    }
  }
  return new PdfUserFacingError(
    'Could not open this PDF. Try another file or re-export the document.',
  )
}
