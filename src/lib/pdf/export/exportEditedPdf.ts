import { loadPdfLibDocument, PdfLibLoadError } from '@/lib/pdf/pdfLibBridge'
import {
  flattenPagesToImages,
  pruneUnreachableObjects,
  removeFormFieldsForWidgets,
  removeStructureTree,
  type FlattenedPageInput,
} from '@/lib/redaction/flattenPages'
import { labelEditedCopyMetadata, markModifiedCopy } from '@/lib/redaction/markModifiedCopy'
import {
  describeExportedModifications,
  maskModeOf,
  requiresModifiedCopyLabel,
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
import type { AnnotationOverlayObject } from '@/types/annotationOverlay'
import { isAnnotationOverlay, isMaskOverlay, type OverlayObject } from '@/types/overlayObjects'
import { addAnnotationsToPage } from './annotations'
import { readPageContentRecords } from './contentIntegrity'
import {
  documentFeatureWarnings,
  readDocumentFeatures,
  type DocumentFeatures,
} from './documentFeatures'
import { drawOverlaysOnPage, type ImageBytesProvider } from './drawOverlays'
import {
  describeExcludedOperations,
  selectExportOperations,
  type ExportOperationSelection,
} from './exportOperations'
import type { OpenExportPdfReader } from './exportPdfReader'
import type { ExportProgress, ExportStage } from './exportProgress'
import { inspectExportedPdf, type ExportInspection } from './inspectExportedPdf'
import {
  readPdfLibPageFingerprints,
  type PageFingerprint,
} from './pageFingerprints'
import { validateExportOverlays } from './validateExportOverlays'
import { verifyExportedPdf, type ExportVerificationResult } from './verifyExportedPdf'

export interface ExportEditedPdfOptions {
  source: PdfSource
  /** Overlays as the editor currently shows them. */
  overlays: readonly OverlayObject[]
  /** Last snapshot in the undo history; live edits missing from it are not exported. */
  committedOverlays?: readonly OverlayObject[]
  getImageBytes: ImageBytesProvider
  onProgress?: (progress: ExportProgress) => void
  /** Required when any mask is in `redact` mode (renders and re-reads pages). */
  openInspector?: OpenPdfInspector
  /** Reopens the export with PDF.js to validate it; validation is skipped without it. */
  openReader?: OpenExportPdfReader
  /** Adds a visible "Modified copy" notice to changed pages. */
  markModifiedPages?: boolean
  now?: Date
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
  selection: ExportOperationSelection
  /** Committed overlays that passed validation and were drawn. */
  operations: readonly OverlayObject[]
  features: DocumentFeatures
  featureWarnings: readonly string[]
  /** PDF.js reopen and edit-visibility checks; null when no reader was given. */
  inspection: ExportInspection | null
  flattenedPages: readonly number[]
  addedTextByPage: ReadonlyMap<number, string>
  limitations: readonly string[]
}

export class ExportValidationError extends Error {
  details: readonly string[]

  constructor(message: string, details: readonly string[]) {
    super(message)
    this.name = 'ExportValidationError'
    this.details = details
  }
}

/** What this export pipeline cannot guarantee; shown with every report. */
export function exportLimitations(modifications: ModificationSummary): string[] {
  const limits = [
    'pdf-lib re-saves the whole file: object layout, compression and cross-reference tables change and earlier revisions are dropped. Untouched page content is copied byte-for-byte, but the file is not byte-identical to the original.',
    'Edits are drawn on top of the original page content. Unless a page is redacted, the original text, images and graphics stay in the file underneath.',
    "New text uses standard PDF fonts (Helvetica, Times, Courier), not the document's embedded fonts, so glyph shapes and spacing can differ. Characters outside the Western European set cannot be written as text.",
    'Annotations, links and form fields are drawn by viewers above page content, so covers cannot hide them.',
    'Validation reopens the file with PDF.js and compares extracted text and renders. These checks are heuristics: other viewers may render differently, and text inside images cannot be read back.',
  ]
  if (modifications.redactions > 0) {
    limits.push(
      'Redacted pages are replaced by an image of the page: their remaining text is no longer selectable, and their links and annotations are removed.',
    )
  }
  if (modifications.ocrEdits > 0 || modifications.images > 0) {
    limits.push(
      'Image-based edits (changes to scanned text, inserted images) are overlays; the original image pixels remain in the file.',
    )
  }
  return limits
}

export async function exportEditedPdf(
  options: ExportEditedPdfOptions,
): Promise<ExportEditedPdfResult> {
  const warnings: string[] = []
  const progress = (stage: ExportStage, message: string): void =>
    options.onProgress?.({ stage, message })
  const now = options.now ?? new Date()
  const dateLabel = now.toISOString().slice(0, 10)

  progress('preparing', 'Loading original PDF…')
  let pdfDoc
  try {
    pdfDoc = await loadPdfLibDocument(options.source, { updateMetadata: false })
  } catch (cause) {
    const message = cause instanceof PdfLibLoadError ? cause.message : 'The original PDF could not be loaded.'
    throw new ExportValidationError(message, [message])
  }
  const pageCount = pdfDoc.getPageCount()
  const sourceFingerprints = readPdfLibPageFingerprints(pdfDoc)
  const sourceContent = readPageContentRecords(pdfDoc)
  const features = readDocumentFeatures(pdfDoc, options.source.originalBytes)

  progress('preparing', 'Selecting committed edits…')
  const selection = selectExportOperations({
    present: options.overlays,
    committed: options.committedOverlays,
  })
  const hiddenCount = selection.excluded.filter((entry) => entry.reason === 'hidden').length
  const excludedNote = describeExcludedOperations(selection.excluded)
  if (excludedNote) {
    warnings.push(excludedNote)
  }

  const validation = validateExportOverlays(
    selection.operations,
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
  const operations = validation.exportableOverlays
  const modifications: ModificationSummary = {
    ...summarizeModifications(operations),
    hidden: hiddenCount,
  }

  if (operations.length === 0 && selection.operations.length > 0) {
    warnings.push(
      'No overlays could be exported after validation; the download will match the original PDF.',
    )
  }

  warnings.push(
    'Export draws committed overlays only. Selection handles and guides are not included.',
  )
  const featureWarnings = documentFeatureWarnings(features, operations)
  warnings.push(...featureWarnings)

  const redactMasks = operations
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
        progress('applying', `Redacting page ${pageIndex + 1}: flattening to an image…`)
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
      'Pages keep their original content streams; edits are drawn on top (no page is rasterized).',
    )
  }
  const flattenedPages = new Set(redactedPages.map((page) => page.pageIndex))

  const editedPages = new Set(operations.map((object) => object.pageIndex))
  for (const pageIndex of [...editedPages].sort((a, b) => a - b)) {
    progress('applying', `Drawing edits on page ${pageIndex + 1} of ${pageCount}…`)
    const page = pdfDoc.getPage(pageIndex)
    await drawOverlaysOnPage(
      pdfDoc,
      page,
      pageIndex,
      operations,
      options.getImageBytes,
      warnings,
    )
    addAnnotationsToPage(
      pdfDoc,
      page,
      operations.filter(
        (object): object is AnnotationOverlayObject =>
          isAnnotationOverlay(object) && object.pageIndex === pageIndex,
      ),
    )
  }
  if (modifications.annotations > 0) {
    warnings.push(
      `${modifications.annotations} annotation(s) were added as PDF comments. They do not change the page content and recipients can hide or delete them.`,
    )
  }

  const documentSummary = describeExportedModifications(modifications)
  let addedTextByPage = new Map<number, string>()
  // Changed amounts and edited scans alter what the document states, so the copy is always labelled.
  const labelRequired = requiresModifiedCopyLabel(modifications)
  const markPages = options.markModifiedPages || labelRequired
  if (labelRequired && !options.markModifiedPages) {
    if (modifications.amountEdits > 0) {
      warnings.push(
        'Edited amounts always add a “Modified copy” notice to the changed pages and the document keywords.',
      )
    }
    if (modifications.ocrEdits > 0) {
      warnings.push(
        'Edits to scanned text always add a “Modified copy” notice to the changed pages and the document keywords.',
      )
    }
  }
  if (markPages && documentSummary) {
    progress('applying', 'Adding “Modified copy” notices…')
    const perPage = new Map<number, string>()
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageSummary = describeExportedModifications(
        summarizeModifications(
          operations.filter((object) => object.pageIndex === pageIndex),
        ),
      )
      if (pageSummary) {
        perPage.set(pageIndex, pageSummary)
      }
    }
    addedTextByPage = await markModifiedCopy(pdfDoc, perPage, dateLabel)
    for (const pageIndex of addedTextByPage.keys()) {
      editedPages.add(pageIndex)
    }
  }
  labelEditedCopyMetadata(pdfDoc, documentSummary, dateLabel, now)

  if (redactMasks.length > 0) {
    pruneUnreachableObjects(pdfDoc)
  }

  progress('saving', 'Saving PDF…')
  const bytes = await pdfDoc.save()

  progress('validating', 'Reopening the exported file with pdf-lib…')
  const verification = await verifyExportedPdf(sourceFingerprints, bytes, {
    sourceContent,
    editedPages,
    flattenedPages,
  })
  warnings.push(...verification.warnings)
  if (!verification.ok) {
    warnings.unshift(...verification.errors.map((error) => `Verification: ${error}`))
  }

  let redaction: RedactionVerification | null = null
  if (redactedPages.length > 0 && options.openInspector) {
    progress('validating', 'Verifying redactions in the exported file…')
    redaction = await verifyRedactedExport({
      exportedBytes: bytes,
      pages: redactedPages,
      openInspector: options.openInspector,
      addedTextByPage,
    })
  }

  let inspection: ExportInspection | null = null
  if (options.openReader && verification.readable) {
    progress('validating', 'Reopening the exported file with PDF.js…')
    inspection = await inspectExportedPdf({
      originalBytes: options.source.originalBytes,
      exportedBytes: bytes,
      operations,
      changes: selection.changes.filter((change) =>
        change.objectIds.some((id) => operations.some((object) => object.id === id)),
      ),
      flattenedPages,
      addedTextByPage,
      openReader: options.openReader,
      onProgress: (message) => progress('validating', message),
    })
  }

  if (modifications.covers > 0) {
    warnings.push(
      'Visual covers only — original PDF text may remain underneath masks. Covers are not secure redaction.',
    )
  }
  warnings.push(
    'Vector text in the download uses the standard PDF fonts (Helvetica/Times/Courier, not embedded), not the original document fonts. The editor preview may look different — widen masks if old text still shows through.',
  )

  progress('done', 'Export finished.')
  return {
    bytes,
    warnings,
    verification,
    sourceFingerprints,
    exportedOverlayCount: operations.length,
    modifications,
    redaction,
    selection,
    operations,
    features,
    featureWarnings,
    inspection,
    flattenedPages: [...flattenedPages].sort((a, b) => a - b),
    addedTextByPage,
    limitations: exportLimitations(modifications),
  }
}
