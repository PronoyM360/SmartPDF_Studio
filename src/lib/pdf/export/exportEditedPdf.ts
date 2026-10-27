import { loadPdfLibDocument } from '@/lib/pdf/pdfLibBridge'
import {
  flattenPagesToImages,
  pruneUnreachableObjects,
  removeFormFieldsForWidgets,
  removeStructureTree,
  type FlattenedPageInput,
} from '@/lib/redaction/flattenPages'
import { markModifiedCopy } from '@/lib/redaction/markModifiedCopy'
import {
  describeExportedModifications,
  exportableOverlayObjects,
  maskModeOf,
  summarizeModifications,
  type ModificationSummary,
} from '@/lib/redaction/maskModes'
import type { OpenPdfInspector, RedactionArea } from '@/lib/redaction/types'
import {
  collectRedactionNeedles,
  verifyRedactedExport,
  type RedactedPageRecord,
  type RedactionVerification,
} from '@/lib/redaction/verifyRedactedExport'
import type { PdfSource } from '@/types'
import { isMaskOverlay, type OverlayObject } from '@/types/overlayObjects'
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
  /** Required when any mask is in `redact` mode (renders and re-reads pages). */
  openInspector?: OpenPdfInspector
  /** Adds a visible "Modified copy" notice to changed pages plus document keywords. */
  markModifiedPages?: boolean
}

export interface ExportEditedPdfResult {
  bytes: Uint8Array
  warnings: string[]
  verification: ExportVerificationResult
  sourceFingerprints: readonly PageFingerprint[]
  exportedOverlayCount: number
  modifications: ModificationSummary
  /** Present when the export contains redactions. */
  redaction: RedactionVerification | null
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

  const modifications = summarizeModifications(options.overlays)
  if (modifications.hidden > 0) {
    warnings.push(
      `${modifications.hidden} hidden region(s) are editor-preview only and are not part of the download.`,
    )
  }

  const validation = validateExportOverlays(
    exportableOverlayObjects(options.overlays),
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

  const redactMasks = validation.exportableOverlays
    .filter(isMaskOverlay)
    .filter((mask) => maskModeOf(mask) === 'redact')
  const redactedPages: RedactedPageRecord[] = []

  if (redactMasks.length > 0) {
    if (!options.openInspector) {
      throw new ExportValidationError('Redaction needs page rendering.', [
        'Redactions can only be exported in a browser that can render pages. Remove the redactions or retry in a supported browser.',
      ])
    }
    const areasByPage = new Map<number, RedactionArea[]>()
    for (const mask of redactMasks) {
      const list = areasByPage.get(mask.pageIndex) ?? []
      list.push({ bounds: mask.bounds, fillColor: mask.fillColor })
      areasByPage.set(mask.pageIndex, list)
    }

    const inspector = await options.openInspector(options.source.originalBytes.slice())
    const flattened: FlattenedPageInput[] = []
    try {
      if (!inspector.rasterizeWithRedactions) {
        throw new ExportValidationError('Redaction needs page rendering.', [
          'This environment cannot render pages, so redactions cannot be applied.',
        ])
      }
      for (const [pageIndex, areas] of [...areasByPage].sort((a, b) => a[0] - b[0])) {
        options.onProgress?.(`Redacting page ${pageIndex + 1}: flattening to an image…`)
        const runs = await inspector.readPageText(pageIndex)
        redactedPages.push({
          pageIndex,
          areas,
          needles: collectRedactionNeedles(runs, areas),
        })
        const raster = await inspector.rasterizeWithRedactions(pageIndex, areas)
        flattened.push({ pageIndex, png: raster.png, visibleBox: raster.visibleBox })
      }
    } finally {
      await inspector.destroy()
    }

    const removedWidgets = await flattenPagesToImages(pdfDoc, flattened)
    const removedFields = removeFormFieldsForWidgets(pdfDoc, removedWidgets)
    if (removedFields > 0) {
      warnings.push(
        `${removedFields} form field(s) on redacted pages were removed together with their values.`,
      )
    }
    if (removeStructureTree(pdfDoc)) {
      warnings.push(
        'Accessibility tags (structure tree) were removed because they can repeat redacted text.',
      )
    }
    warnings.push(
      `Redacted page(s) ${redactedPages.map((page) => page.pageIndex + 1).join(', ')} were flattened to images: their remaining text is no longer selectable or searchable, and links/annotations on those pages were removed. Other pages keep their original content.`,
    )
  } else {
    warnings.push(
      'Original page content is preserved as vector/text under new draw commands (no full-page rasterization).',
    )
  }

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

  const documentSummary = describeExportedModifications(modifications)
  let addedTextByPage = new Map<number, string>()
  // Changed amounts alter official figures, so the copy is always labelled.
  const markPages = options.markModifiedPages || modifications.amountEdits > 0
  if (modifications.amountEdits > 0 && !options.markModifiedPages) {
    warnings.push(
      'Edited amounts always add a “Modified copy” notice to the changed pages and the document keywords.',
    )
  }
  if (markPages && documentSummary) {
    const perPage = new Map<number, string>()
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageSummary = describeExportedModifications(
        summarizeModifications(
          validation.exportableOverlays.filter((object) => object.pageIndex === pageIndex),
        ),
      )
      if (pageSummary) {
        perPage.set(pageIndex, pageSummary)
      }
    }
    addedTextByPage = await markModifiedCopy(
      pdfDoc,
      perPage,
      documentSummary,
      new Date().toISOString().slice(0, 10),
    )
  }

  if (redactMasks.length > 0) {
    pruneUnreachableObjects(pdfDoc)
  }

  options.onProgress?.('Saving PDF…')
  const bytes = await pdfDoc.save()

  options.onProgress?.('Verifying exported PDF…')
  const verification = await verifyExportedPdf(sourceFingerprints, bytes)
  warnings.push(...verification.warnings)
  if (!verification.ok) {
    warnings.unshift(...verification.errors.map((error) => `Verification: ${error}`))
  }

  let redaction: RedactionVerification | null = null
  if (redactedPages.length > 0 && options.openInspector) {
    options.onProgress?.('Verifying redactions in the exported file…')
    redaction = await verifyRedactedExport({
      exportedBytes: bytes,
      pages: redactedPages,
      openInspector: options.openInspector,
      addedTextByPage,
    })
  }

  if (modifications.covers > 0) {
    warnings.push(
      'Visual covers only — original PDF text may remain underneath masks. Covers are not secure redaction.',
    )
  }
  warnings.push(
    'Downloaded PDF uses standard embedded fonts (Helvetica/Times/Courier). Browser preview may use different fonts — widen masks if old text still shows through.',
  )

  return {
    bytes,
    warnings,
    verification,
    sourceFingerprints,
    exportedOverlayCount: validation.exportableOverlays.length,
    modifications,
    redaction,
  }
}
