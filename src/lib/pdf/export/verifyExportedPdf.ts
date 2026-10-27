import { PDFDocument } from 'pdf-lib'
import {
  compareContentRecords,
  countAddedStrokeOperators,
  readPageContentRecords,
  type ContentIntegrityResult,
  type PageContentRecord,
} from './contentIntegrity'
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
  /** Null when no source content records were supplied or the file was unreadable. */
  readonly contentIntegrity: ContentIntegrityResult | null
  /** Stroke operators found in drawing the export added; null when not checked. */
  readonly addedStrokeOperators: number | null
}

export interface ContentVerificationInput {
  readonly sourceContent: readonly PageContentRecord[]
  readonly editedPages: ReadonlySet<number>
  readonly flattenedPages: ReadonlySet<number>
}

function unreadable(error: string): ExportVerificationResult {
  return {
    ok: false,
    readable: false,
    errors: [error],
    warnings: [],
    exportedFingerprints: [],
    contentIntegrity: null,
    addedStrokeOperators: null,
  }
}

/**
 * Reopens exported bytes with pdf-lib and checks structural fidelity vs the source:
 * page boxes and rotation, and (when given) that original content streams survive.
 */
export async function verifyExportedPdf(
  sourceFingerprints: readonly PageFingerprint[],
  exportedBytes: Uint8Array,
  content?: ContentVerificationInput,
): Promise<ExportVerificationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (exportedBytes.byteLength < 5) {
    return unreadable('Exported file is empty or too small to be a PDF.')
  }

  if (
    exportedBytes[0] !== 0x25 ||
    exportedBytes[1] !== 0x50 ||
    exportedBytes[2] !== 0x44 ||
    exportedBytes[3] !== 0x46
  ) {
    return unreadable('Exported file does not begin with a PDF header (%PDF).')
  }

  let exportedDoc: PDFDocument
  try {
    exportedDoc = await PDFDocument.load(exportedBytes.slice(), {
      ignoreEncryption: true,
      updateMetadata: false,
    })
  } catch {
    return unreadable('Exported PDF could not be parsed. The download may be corrupt.')
  }

  const exportedFingerprints = readPdfLibPageFingerprints(exportedDoc)
  const structure = comparePageFingerprints(sourceFingerprints, exportedFingerprints)
  errors.push(...structure.errors)
  warnings.push(...structure.warnings)

  let contentIntegrity: ContentIntegrityResult | null = null
  let addedStrokeOperators: number | null = null
  if (content) {
    contentIntegrity = compareContentRecords(
      content.sourceContent,
      readPageContentRecords(exportedDoc),
      content,
    )
    errors.push(...contentIntegrity.errors)
    warnings.push(...contentIntegrity.warnings)
    addedStrokeOperators = countAddedStrokeOperators(
      exportedDoc,
      content.sourceContent,
      [...content.editedPages].filter((pageIndex) => !content.flattenedPages.has(pageIndex)),
    )
  }

  return {
    ok: errors.length === 0,
    readable: true,
    errors,
    warnings,
    exportedFingerprints,
    contentIntegrity,
    addedStrokeOperators,
  }
}
