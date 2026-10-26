import { PDFDocument } from 'pdf-lib'
import {
  comparePageFingerprints,
  readPdfLibPageFingerprints,
  type PageFingerprint,
} from './pageFingerprints'

export interface ExportVerificationResult {
  readonly ok: boolean
  readonly readable: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly exportedFingerprints: readonly PageFingerprint[]
}

/**
 * Reopens exported bytes with pdf-lib and checks structural fidelity vs the source.
 */
export async function verifyExportedPdf(
  sourceFingerprints: readonly PageFingerprint[],
  exportedBytes: Uint8Array,
): Promise<ExportVerificationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (exportedBytes.byteLength < 5) {
    return {
      ok: false,
      readable: false,
      errors: ['Exported file is empty or too small to be a PDF.'],
      warnings,
      exportedFingerprints: [],
    }
  }

  if (
    exportedBytes[0] !== 0x25 ||
    exportedBytes[1] !== 0x50 ||
    exportedBytes[2] !== 0x44 ||
    exportedBytes[3] !== 0x46
  ) {
    return {
      ok: false,
      readable: false,
      errors: ['Exported file does not begin with a PDF header (%PDF).'],
      warnings,
      exportedFingerprints: [],
    }
  }

  let exportedDoc: PDFDocument
  try {
    exportedDoc = await PDFDocument.load(exportedBytes.slice(), {
      ignoreEncryption: true,
      updateMetadata: false,
    })
  } catch {
    return {
      ok: false,
      readable: false,
      errors: ['Exported PDF could not be parsed. The download may be corrupt.'],
      warnings,
      exportedFingerprints: [],
    }
  }

  const exportedFingerprints = readPdfLibPageFingerprints(exportedDoc)
  const structure = comparePageFingerprints(sourceFingerprints, exportedFingerprints)
  errors.push(...structure.errors)
  warnings.push(...structure.warnings)

  warnings.push(
    'Verification checks page structure only. Link, annotation, and form field preservation depends on the PDF and viewer; export adds overlay drawing commands without rasterizing pages.',
  )

  return {
    ok: errors.length === 0,
    readable: true,
    errors,
    warnings,
    exportedFingerprints,
  }
}
