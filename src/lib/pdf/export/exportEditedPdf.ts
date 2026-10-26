import { loadPdfLibDocument } from '@/lib/pdf/pdfLibBridge'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import { drawOverlaysOnPage, type ImageBytesProvider } from './drawOverlays'
import {
  readPdfLibPageFingerprints,
  type PageFingerprint,
} from './pageFingerprints'
import { validateExportOverlays } from './validateExportOverlays'
import { verifyExportedPdf, type ExportVerificationResult } from './verifyExportedPdf'

export interface ExportEditedPdfOptions {
  source: PdfSource
  overlays: readonly OverlayObject[]
  getImageBytes: ImageBytesProvider
  onProgress?: (message: string) => void
}

export interface ExportEditedPdfResult {
  bytes: Uint8Array
  warnings: string[]
  verification: ExportVerificationResult
  sourceFingerprints: readonly PageFingerprint[]
  exportedOverlayCount: number
}

export class ExportValidationError extends Error {
  details: readonly string[]

  constructor(message: string, details: readonly string[]) {
    super(message)
    this.name = 'ExportValidationError'
    this.details = details
  }
}

export async function exportEditedPdf(
  options: ExportEditedPdfOptions,
): Promise<ExportEditedPdfResult> {
  const warnings: string[] = []
  options.onProgress?.('Loading original PDF…')

  const pdfDoc = await loadPdfLibDocument(options.source)
  const pageCount = pdfDoc.getPageCount()
  const sourceFingerprints = readPdfLibPageFingerprints(pdfDoc)

  const validation = validateExportOverlays(
    options.overlays,
    pageCount,
    options.getImageBytes,
  )
  warnings.push(...validation.warnings)

  if (!validation.ok) {
    throw new ExportValidationError(
      'Export blocked due to validation errors.',
      validation.blockingErrors,
    )
  }

  if (validation.exportableOverlays.length === 0 && options.overlays.length > 0) {
    warnings.push(
      'No overlays could be exported after validation; the download will match the original PDF.',
    )
  }

  warnings.push(
    'Export draws committed overlays only. Selection handles and guides are not included.',
  )
  warnings.push(
    'Original page content is preserved as vector/text under new draw commands (no full-page rasterization).',
  )

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    options.onProgress?.(
      `Drawing overlays on page ${pageIndex + 1} of ${pageCount}…`,
    )
    const page = pdfDoc.getPage(pageIndex)
    await drawOverlaysOnPage(
      pdfDoc,
      page,
      pageIndex,
      validation.exportableOverlays,
      options.getImageBytes,
      warnings,
    )
  }

  options.onProgress?.('Saving PDF…')
  const bytes = await pdfDoc.save()

  options.onProgress?.('Verifying exported PDF…')
  const verification = await verifyExportedPdf(sourceFingerprints, bytes)
  warnings.push(...verification.warnings)
  if (!verification.ok) {
    warnings.unshift(...verification.errors.map((error) => `Verification: ${error}`))
  }

  warnings.push(
    'Visual overlays only — original PDF text may remain underneath masks. This is not secure redaction or native text replacement.',
  )
  warnings.push(
    'Downloaded PDF uses standard embedded fonts (Helvetica/Times/Courier). Browser preview may use different fonts — widen masks if old text still shows through.',
  )

  return {
    bytes,
    warnings,
    verification,
    sourceFingerprints,
    exportedOverlayCount: validation.exportableOverlays.length,
  }
}
