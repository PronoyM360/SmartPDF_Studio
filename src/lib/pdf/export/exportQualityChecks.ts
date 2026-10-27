import { loadPdfLibDocument, PdfLibLoadError } from '@/lib/pdf/pdfLibBridge'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import {
  exportEditedPdf,
  exportLimitations,
  ExportValidationError,
  type ExportEditedPdfResult,
} from '@/lib/pdf/export/exportEditedPdf'
import { validateExportOverlays } from '@/lib/pdf/export/validateExportOverlays'
import { comparePageFingerprints } from '@/lib/pdf/export/pageFingerprints'
import type { ImageBytesProvider } from '@/lib/pdf/export/drawOverlays'
import {
  describeExcludedOperations,
  selectExportOperations,
  type ExcludedOperation,
} from '@/lib/pdf/export/exportOperations'
import { openBrowserExportReader, type OpenExportPdfReader } from '@/lib/pdf/export/exportPdfReader'
import type { ExportProgress } from '@/lib/pdf/export/exportProgress'
import {
  MAX_UNTOUCHED_PIXEL_DIFFERENCE,
  type EditCheckStatus,
  type ExportInspection,
} from '@/lib/pdf/export/inspectExportedPdf'
import type { ExportVerificationResult } from '@/lib/pdf/export/verifyExportedPdf'
import { openBrowserInspector } from '@/lib/redaction/browserPdfTools'
import {
  describeExportedModifications,
  requiresModifiedCopyLabel,
  summarizeModifications,
} from '@/lib/redaction/maskModes'
import type { OpenPdfInspector } from '@/lib/redaction/types'
import { MIN_FILL_COVERAGE } from '@/lib/redaction/verifyRedactedExport'

export type ExportQualityCheckStatus = 'passed' | 'warning' | 'failed' | 'not_checked'

export interface ExportQualityCheckSubItem {
  readonly status: ExportQualityCheckStatus
  readonly text: string
}

export interface ExportQualityCheckItem {
  readonly id: string
  readonly title: string
  readonly status: ExportQualityCheckStatus
  readonly detail: string
  readonly approximate?: boolean
  readonly subItems?: readonly ExportQualityCheckSubItem[]
}

export interface ExportQualityReport {
  readonly checks: readonly ExportQualityCheckItem[]
  readonly canDownload: boolean
  readonly exportResult: ExportEditedPdfResult | null
  readonly blockingMessage: string | null
  /** What the export cannot guarantee, regardless of the check results. */
  readonly limitations: readonly string[]
  /** Editor objects that were deliberately left out of the export. */
  readonly excluded: readonly ExcludedOperation[]
}

export interface RunExportQualityChecksOptions {
  source: PdfSource
  overlays: readonly OverlayObject[]
  /** Last committed snapshot; live edits not in it are excluded. */
  committedOverlays?: readonly OverlayObject[]
  getImageBytes: ImageBytesProvider
  expectedPageCount: number
  onProgress?: (progress: ExportProgress) => void
  /** When false, skips reopening the export with PDF.js. Defaults to true. */
  inspectWithPdfJs?: boolean
  /** Adds a visible "Modified copy" notice to changed pages. */
  markModifiedPages?: boolean
  /** Defaults to the PDF.js + canvas inspector when a browser document exists. */
  openInspector?: OpenPdfInspector
  /** Defaults to the browser PDF.js reader when a browser document exists. */
  openReader?: OpenExportPdfReader
}

function item(
  id: string,
  title: string,
  status: ExportQualityCheckStatus,
  detail: string,
  approximate = false,
  subItems?: readonly ExportQualityCheckSubItem[],
): ExportQualityCheckItem {
  return {
    id,
    title,
    status,
    detail,
    approximate: approximate || undefined,
    ...(subItems && subItems.length > 0 ? { subItems } : {}),
  }
}

const MAX_RENDER_PROBE_PAGES = 6

/** Pages to render after export: every edited page (capped), or the first page. */
export function renderProbePages(overlays: readonly OverlayObject[], pageCount: number): number[] {
  const edited = [...new Set(overlays.map((object) => object.pageIndex))]
    .filter((index) => index >= 0 && index < pageCount)
    .sort((a, b) => a - b)
  return edited.length > 0 ? edited.slice(0, MAX_RENDER_PROBE_PAGES) : [0]
}

/** Plain statement of what OCR-assisted edits are, so nobody mistakes them for originals. */
export function ocrEditCheck(overlays: readonly OverlayObject[]): ExportQualityCheckItem | null {
  const edits = overlays.flatMap((object) =>
    object.kind === 'text' && object.ocrEdit ? [{ pageIndex: object.pageIndex, record: object.ocrEdit }] : [],
  )
  if (edits.length === 0) {
    return null
  }
  const methods = new Map<string, number>()
  for (const { record } of edits) {
    const label =
      record.repairMethod === 'flat-box'
        ? 'flat cover box'
        : record.repairMethod === 'inpaint'
          ? 'inpainted'
          : `${record.repairMethod} fill`
    methods.set(label, (methods.get(label) ?? 0) + 1)
  }
  const complex = edits.filter(
    ({ record }) => record.backgroundKind === 'complex' || record.backgroundKind === 'textured',
  ).length
  const lowConfidence = edits.filter(({ record }) => record.confidence < 60).length
  const pages = [...new Set(edits.map((edit) => edit.pageIndex + 1))].sort((a, b) => a - b).join(', ')
  const methodList = [...methods].map(([label, count]) => `${count} ${label}`).join(', ')
  const extras = [
    complex > 0 ? `${complex} sit on textured or complex backgrounds where repair is least reliable` : null,
    lowConfidence > 0 ? `${lowConfidence} started from low-confidence OCR` : null,
  ].filter(Boolean)
  return item(
    'ocr_edits',
    'OCR-assisted edits are approximate',
    'warning',
    `${edits.length} OCR-assisted edit(s) on page ${pages}. Text position, size, font and colour were estimated from the scan, and backgrounds were rebuilt locally (${methodList}).${extras.length > 0 ? ` Of these, ${extras.join('; ')}.` : ''} The original scan pixels remain in the file under each patch. Compare the export with the original before sharing.`,
    true,
  )
}

export function committedOnlyCheck(
  excluded: readonly ExcludedOperation[],
  exportedCount: number,
): ExportQualityCheckItem {
  const note = describeExcludedOperations(excluded)
  const live = excluded.filter((entry) => entry.reason === 'uncommitted').length
  if (live > 0) {
    return item(
      'committed_only',
      'Only committed edits are exported',
      'warning',
      `${note} Finish or commit those edits and run the checks again if they should be included.`,
    )
  }
  return item(
    'committed_only',
    'Only committed edits are exported',
    'passed',
    `${exportedCount} committed edit(s) exported. Drafts, pending replacements and selections are never part of the export.${note ? ` ${note}` : ''}`,
  )
}

export function documentFeaturesCheck(featureWarnings: readonly string[]): ExportQualityCheckItem {
  if (featureWarnings.length === 0) {
    return item(
      'document_features',
      'Document structure supports editing',
      'passed',
      'No signatures, encryption, XFA forms, revision history or overlapping annotations were detected.',
    )
  }
  return item(
    'document_features',
    'Document structure supports editing',
    'warning',
    `${featureWarnings.length} point(s) about this document affect the edited copy.`,
    false,
    featureWarnings.map((text) => ({ status: 'warning' as const, text })),
  )
}

export function contentPreservationCheck(verification: ExportVerificationResult): ExportQualityCheckItem {
  const integrity = verification.contentIntegrity
  if (!integrity) {
    return item(
      'content_preserved',
      'Untouched page content is preserved',
      'not_checked',
      'Content streams were not compared.',
    )
  }
  if (!integrity.ok) {
    return item(
      'content_preserved',
      'Untouched page content is preserved',
      'failed',
      integrity.errors.join(' '),
    )
  }
  const identical = integrity.pages.filter((page) => page.status === 'identical').length
  const preserved = integrity.pages.filter((page) => page.status === 'preserved').length
  const replaced = integrity.pages.filter((page) => page.status === 'replaced').length
  const parts = [
    `${identical} untouched page(s) keep their content streams byte-for-byte`,
    preserved > 0 ? `${preserved} edited page(s) keep their original streams with new drawing added on top` : null,
    replaced > 0 ? `${replaced} redacted page(s) were intentionally replaced by an image` : null,
  ].filter(Boolean)
  return item(
    'content_preserved',
    'Untouched page content is preserved',
    'passed',
    `${parts.join('; ')}. Page order matches the original. The file as a whole is re-saved by pdf-lib, so it is not byte-identical.`,
  )
}

export function editorArtifactCheck(
  verification: ExportVerificationResult,
  overlays: readonly OverlayObject[],
): ExportQualityCheckItem {
  const unexpectedKind = overlays.find(
    (object) => !['text', 'image', 'mask', 'annotation'].includes(object.kind),
  )
  if (unexpectedKind) {
    return item(
      'no_editor_chrome',
      'Editing guides and selection handles excluded',
      'failed',
      'Unexpected object type in committed edits.',
    )
  }
  if (verification.addedStrokeOperators === null) {
    return item(
      'no_editor_chrome',
      'Editing guides and selection handles excluded',
      'passed',
      'The export is generated from the edit data (text, image, mask and annotation objects), not from the editor canvas, so handles and guides are never drawn.',
    )
  }
  if (verification.addedStrokeOperators > 0) {
    return item(
      'no_editor_chrome',
      'Editing guides and selection handles excluded',
      'failed',
      `${verification.addedStrokeOperators} outline (stroke) command(s) were found in the drawing added to the pages. Edits only fill shapes, draw text and place images, so these are unexpected.`,
    )
  }
  return item(
    'no_editor_chrome',
    'Editing guides and selection handles excluded',
    'passed',
    'The export is generated from the edit data, not the editor canvas. The drawing added to each edited page contains only fills, text and images — no outlines, handles or guides.',
  )
}

const EDIT_STATUS: Record<EditCheckStatus, ExportQualityCheckStatus> = {
  verified: 'passed',
  warning: 'warning',
  failed: 'failed',
  not_checked: 'not_checked',
}

/** Checks derived from reopening the export with PDF.js. */
export function inspectionChecks(
  inspection: ExportInspection | null,
  requested: boolean,
): ExportQualityCheckItem[] {
  if (!inspection) {
    const detail = requested
      ? 'PDF.js is not available in this environment, so the export was not reopened for inspection.'
      : 'Reopening with PDF.js was turned off for this run.'
    return [
      item('pdfjs_reopen', 'Exported file reopens in PDF.js', 'not_checked', detail),
      item('untouched_pages', 'Untouched pages match the original', 'not_checked', detail),
      item('edits_visible', 'Edits are visible in the exported file', 'not_checked', detail),
    ]
  }
  if (!inspection.opened) {
    const detail = inspection.error ?? 'PDF.js could not open the exported file.'
    return [item('pdfjs_reopen', 'Exported file reopens in PDF.js', 'failed', detail)]
  }

  const checks: ExportQualityCheckItem[] = []
  const countsMatch = inspection.originalPageCount === inspection.exportedPageCount
  checks.push(
    item(
      'pdfjs_reopen',
      'Exported file reopens in PDF.js',
      countsMatch ? 'passed' : 'failed',
      countsMatch
        ? `PDF.js (the renderer used by this app) opened the export and reads ${inspection.exportedPageCount} page(s), like the original.`
        : `PDF.js reads ${inspection.exportedPageCount} page(s) in the export but ${inspection.originalPageCount} in the original.`,
    ),
  )

  const untouched = inspection.pages.filter((page) => !page.edited && !page.flattened)
  if (untouched.length === 0) {
    checks.push(
      item('untouched_pages', 'Untouched pages match the original', 'not_checked', 'Every page has edits, so there are no untouched pages to compare.'),
    )
  } else {
    const textCompared = untouched.filter((page) => page.textMatchesOriginal !== null)
    const textMismatch = textCompared.filter((page) => page.textMatchesOriginal === false)
    const rendered = untouched.filter((page) => page.pixelDifference !== null)
    const renderMismatch = rendered.filter((page) => page.pixelDifference! > MAX_UNTOUCHED_PIXEL_DIFFERENCE)
    const problems = [
      textMismatch.length > 0 ? `extracted text differs on page ${textMismatch.map((page) => page.pageIndex + 1).join(', ')}` : null,
      renderMismatch.length > 0
        ? `rendering differs on page ${renderMismatch.map((page) => `${page.pageIndex + 1} (${(page.pixelDifference! * 100).toFixed(2)}% of pixels)`).join(', ')}`
        : null,
    ].filter(Boolean)
    const scope = [
      `text compared on ${textCompared.length} of ${untouched.length} untouched page(s)`,
      rendered.length > 0
        ? `rendering compared on ${rendered.length} page(s) at low resolution`
        : 'rendering not available for comparison',
    ].join('; ')
    checks.push(
      problems.length > 0
        ? item('untouched_pages', 'Untouched pages match the original', 'failed', `${problems.join('; ')} (${scope}).`, true)
        : item(
            'untouched_pages',
            'Untouched pages match the original',
            'passed',
            `Untouched pages read and render the same as the original in PDF.js (${scope}).`,
            true,
          ),
    )
  }

  if (inspection.edits.length === 0) {
    checks.push(item('edits_visible', 'Edits are visible in the exported file', 'not_checked', 'There are no committed edits to look for.'))
  } else {
    const statuses = inspection.edits.map((edit) => EDIT_STATUS[edit.status])
    const status: ExportQualityCheckStatus = statuses.includes('failed')
      ? 'failed'
      : statuses.includes('warning') || statuses.includes('not_checked')
        ? 'warning'
        : 'passed'
    const confirmed = inspection.edits.filter((edit) => edit.status === 'verified' || edit.status === 'warning').length
    checks.push(
      item(
        'edits_visible',
        'Edits are visible in the exported file',
        status,
        `${confirmed} of ${inspection.edits.length} edit(s) confirmed in the reopened file by text extraction and/or rendering.${inspection.renderAvailable ? '' : ' Rendering was unavailable, so only the text layer was checked.'}`,
        true,
        inspection.edits.map((edit) => ({
          status: EDIT_STATUS[edit.status],
          text: `Page ${edit.pageIndex + 1} · ${edit.title}: ${edit.detail}`,
        })),
      ),
    )
  }
  return checks
}

export async function runExportQualityChecks(
  options: RunExportQualityChecksOptions,
): Promise<ExportQualityReport> {
  const checks: ExportQualityCheckItem[] = []
  const inspect = options.inspectWithPdfJs ?? true
  const browser = typeof document !== 'undefined'
  const selection = selectExportOperations({
    present: options.overlays,
    committed: options.committedOverlays,
  })
  const limitations = exportLimitations(summarizeModifications(selection.operations))
  const finish = (
    exportResult: ExportEditedPdfResult | null,
    blockingMessage: string | null,
  ): ExportQualityReport =>
    finalize(checks, exportResult, blockingMessage, limitations, selection.excluded)

  options.onProgress?.({ stage: 'preparing', message: 'Checking export readiness…' })

  let pageCount = options.expectedPageCount
  try {
    const doc = await loadPdfLibDocument(options.source, { updateMetadata: false })
    pageCount = doc.getPageCount()
  } catch (cause) {
    const detail =
      cause instanceof PdfLibLoadError || cause instanceof Error
        ? cause.message
        : 'The original PDF could not be loaded for export.'
    checks.push(item('can_export', 'PDF can be exported', 'failed', detail))
    return finish(null, detail)
  }

  const exportedOverlays = selection.operations
  const validation = validateExportOverlays(
    exportedOverlays,
    pageCount,
    options.getImageBytes,
  )

  if (!validation.ok) {
    checks.push(
      item(
        'valid_objects',
        'No invalid or incomplete editing objects',
        'failed',
        validation.blockingErrors.join(' '),
      ),
    )
    checks.push(
      item(
        'can_export',
        'PDF can be exported',
        'failed',
        'Fix validation errors before exporting.',
      ),
    )
    return finish(null, validation.blockingErrors[0] ?? 'Export blocked.')
  }

  const committedCount = exportedOverlays.length
  const exportableCount = validation.exportableOverlays.length
  const skippedCount = committedCount - exportableCount

  if (skippedCount > 0) {
    checks.push(
      item(
        'valid_objects',
        'No invalid or incomplete editing objects',
        'warning',
        `${skippedCount} committed overlay(s) were skipped (invalid bounds, empty text, or missing image data).`,
        true,
      ),
    )
  } else if (committedCount > 0) {
    checks.push(
      item(
        'valid_objects',
        'No invalid or incomplete editing objects',
        'passed',
        `${committedCount} committed overlay(s) passed pre-export validation.`,
      ),
    )
  } else {
    checks.push(
      item(
        'valid_objects',
        'No invalid or incomplete editing objects',
        'not_checked',
        'No committed overlays to validate.',
      ),
    )
  }

  if (committedCount === 0) {
    checks.push(
      item(
        'committed_edits',
        'Committed edits are present',
        'not_checked',
        'No overlays committed — the export re-saves the original without visible changes.',
      ),
    )
  } else if (exportableCount === 0) {
    checks.push(
      item(
        'committed_edits',
        'Committed edits are present',
        'failed',
        'You have committed edits, but none could be exported. Fix or remove invalid overlays.',
      ),
    )
  } else if (skippedCount > 0) {
    checks.push(
      item(
        'committed_edits',
        'Committed edits are present',
        'warning',
        `${exportableCount} of ${committedCount} overlay(s) will be drawn (others skipped).`,
        true,
      ),
    )
  } else {
    checks.push(
      item(
        'committed_edits',
        'Committed edits are present',
        'passed',
        `${exportableCount} overlay(s) will be included in the export.`,
      ),
    )
  }

  let exportResult: ExportEditedPdfResult
  try {
    exportResult = await exportEditedPdf({
      source: options.source,
      overlays: options.overlays,
      committedOverlays: options.committedOverlays,
      getImageBytes: options.getImageBytes,
      onProgress: options.onProgress,
      markModifiedPages: options.markModifiedPages,
      openInspector: options.openInspector ?? (browser ? openBrowserInspector : undefined),
      openReader: inspect ? (options.openReader ?? (browser ? openBrowserExportReader : undefined)) : undefined,
    })
    checks.push(
      item(
        'can_export',
        'PDF can be exported',
        'passed',
        `Generated ${Math.round(exportResult.bytes.byteLength / 1024)} KB PDF in memory.`,
      ),
    )
  } catch (cause) {
    if (cause instanceof ExportValidationError) {
      const detail = cause.details.join(' ')
      checks.push(item('can_export', 'PDF can be exported', 'failed', detail))
      if (!checks.some((entry) => entry.id === 'valid_objects' && entry.status === 'failed')) {
        checks.push(
          item('valid_objects', 'No invalid or incomplete editing objects', 'failed', detail),
        )
      }
      return finish(null, cause.details[0] ?? 'Export failed.')
    }
    const detail =
      cause instanceof Error ? cause.message : 'Export failed for an unknown reason.'
    checks.push(item('can_export', 'PDF can be exported', 'failed', detail))
    return finish(null, detail)
  }

  const verification = exportResult.verification
  checks.push(committedOnlyCheck(selection.excluded, exportResult.exportedOverlayCount))
  checks.push(documentFeaturesCheck(exportResult.featureWarnings))
  checks.push(editorArtifactCheck(verification, options.overlays))

  if (!verification.readable) {
    checks.push(
      item(
        'reopen_file',
        'Exported file can be reopened',
        'failed',
        verification.errors[0] ?? 'Exported bytes could not be parsed as a PDF.',
      ),
    )
  } else {
    checks.push(
      item(
        'reopen_file',
        'Exported file can be reopened',
        'passed',
        'Exported file was parsed successfully with pdf-lib.',
      ),
    )
    checks.push(contentPreservationCheck(verification))
  }

  const structure = comparePageFingerprints(
    exportResult.sourceFingerprints,
    verification.exportedFingerprints,
  )

  if (structure.errors.some((error) => error.includes('Page count'))) {
    checks.push(
      item(
        'page_count',
        'Page count matches expected',
        'failed',
        structure.errors.find((error) => error.includes('Page count')) ??
          'Page count mismatch.',
      ),
    )
  } else if (pageCount === options.expectedPageCount) {
    checks.push(
      item(
        'page_count',
        'Page count matches expected',
        'passed',
        `${pageCount} page(s) in source and export.`,
      ),
    )
  } else {
    checks.push(
      item(
        'page_count',
        'Page count matches expected',
        'warning',
        `Editor expected ${options.expectedPageCount} page(s); source has ${pageCount}.`,
        true,
      ),
    )
  }

  const layoutErrors = [
    ...structure.errors.filter((error) => !error.includes('Page count')),
    ...(exportResult.inspection?.geometryErrors ?? []),
  ]
  if (layoutErrors.length > 0) {
    checks.push(
      item(
        'page_layout',
        'Page dimensions and rotation preserved',
        'failed',
        layoutErrors.join(' '),
      ),
    )
  } else if (verification.exportedFingerprints.length > 0) {
    checks.push(
      item(
        'page_layout',
        'Page dimensions and rotation preserved',
        'passed',
        `MediaBox, CropBox and rotation of every page match the source (pdf-lib)${exportResult.inspection?.opened ? ', and PDF.js reads the same visible size and rotation' : ''}.`,
      ),
    )
  } else {
    checks.push(
      item(
        'page_layout',
        'Page dimensions and rotation preserved',
        'not_checked',
        'Could not read exported page fingerprints.',
      ),
    )
  }

  checks.push(...modificationChecks(exportResult, options.markModifiedPages ?? false))
  const ocrCheck = ocrEditCheck(validation.exportableOverlays)
  if (ocrCheck) {
    checks.push(ocrCheck)
  }
  checks.push(...inspectionChecks(exportResult.inspection, inspect))

  options.onProgress?.({ stage: 'done', message: 'Checks finished.' })
  return finish(exportResult, null)
}

function pageList(indices: readonly number[]): string {
  return [...new Set(indices)].map((index) => index + 1).join(', ')
}

/** Transparency about hidden regions, visual covers, redactions and the modified-copy label. */
function modificationChecks(
  result: ExportEditedPdfResult,
  markModifiedPages: boolean,
): ExportQualityCheckItem[] {
  const checks: ExportQualityCheckItem[] = []
  const { modifications, redaction } = result

  if (modifications.redactions > 0) {
    const pages = pageList(modifications.redactedPages)
    if (!redaction) {
      checks.push(
        item(
          'redaction',
          'Redactions removed content',
          'failed',
          'Redactions could not be verified in the exported file, so the download is blocked.',
        ),
      )
    } else if (redaction.ok) {
      const measured = redaction.fillCoverage
        .map((entry) => entry.coverage)
        .filter((value): value is number => value !== null)
      const coverageNote =
        measured.length > 0
          ? ` Rendered redacted areas are at least ${Math.floor(Math.min(...measured) * 100)}% filled.`
          : ' Fill coverage could not be rendered in this environment.'
      checks.push(
        item(
          'redaction',
          'Redactions removed content',
          'passed',
          `${modifications.redactions} redaction(s) on page ${pages} verified in the reopened file: those pages have no selectable text layer, and ${redaction.checkedNeedleCount} redacted text string(s) were not found anywhere in the file.${coverageNote} Number-only strings and text in unusual font encodings cannot be searched reliably; the text-layer check covers those.`,
        ),
      )
    } else {
      const reasons: string[] = []
      if (redaction.pagesWithTextLayer.length > 0) {
        reasons.push(`page ${pageList(redaction.pagesWithTextLayer)} still has selectable text`)
      }
      const lowCoverage = redaction.fillCoverage.filter(
        (entry) => entry.coverage !== null && entry.coverage < MIN_FILL_COVERAGE,
      )
      if (lowCoverage.length > 0) {
        reasons.push(`a redacted area on page ${pageList(lowCoverage.map((entry) => entry.pageIndex))} is not fully filled`)
      }
      if (redaction.hiddenLeaks.length > 0) {
        const where = [...new Set(redaction.hiddenLeaks.map((leak) => leak.location.replace('_', ' ')))]
        reasons.push(`redacted text was still found in the file (${where.join(', ')})`)
      }
      checks.push(
        item(
          'redaction',
          'Redactions removed content',
          'failed',
          `Redaction could not be confirmed: ${reasons.join('; ')}. Download is blocked so the file is not mistaken for a redacted copy.`,
        ),
      )
    }
    if (redaction && redaction.visibleElsewhere.length > 0) {
      const sample = redaction.visibleElsewhere[0]!
      checks.push(
        item(
          'redaction_elsewhere',
          'Redacted text does not appear elsewhere',
          'warning',
          `"${sample.needle}" is still visible on page ${pageList(redaction.visibleElsewhere.map((entry) => entry.pageIndex))}, which was not redacted. Redact it there too if it is private.`,
        ),
      )
    }
  }

  if (modifications.covers > 0) {
    checks.push(
      item(
        'visual_covers',
        'Visual covers are not redaction',
        'warning',
        `${modifications.covers} visual cover(s) hide content only visually. The original text and images are still in the file underneath and can be copied or recovered. Use Redact for private information.`,
      ),
    )
  }

  if (modifications.hidden > 0) {
    checks.push(
      item(
        'hidden_regions',
        'Hidden regions excluded from download',
        'passed',
        `${modifications.hidden} region(s) hidden in the editor preview are not part of the download — the exported pages show that content normally.`,
      ),
    )
  }

  if (modifications.amountEdits > 0) {
    checks.push(
      item(
        'amount_edits',
        'Edited amounts are identified',
        'warning',
        `${modifications.amountEdits} printed amount(s) on page ${pageList(modifications.amountEditPages)} were replaced with overlays. The download is labelled as a modified copy; it is not an original or verified document. The original values remain in the file underneath the covers.`,
      ),
    )
  }

  const described = describeExportedModifications(modifications)
  if (described) {
    checks.push(
      markModifiedPages || requiresModifiedCopyLabel(modifications)
        ? item(
            'modified_label',
            'Exported copy is marked as modified',
            'passed',
            `Changed pages carry a small "Modified copy — ${described}" notice, the file is named "-edited", and the document info (producer, modification date, keywords) records the changes.`,
          )
        : item(
            'modified_label',
            'Exported copy is marked as modified',
            'warning',
            'The file is named "-edited" and its document info records the changes, but the pages carry no visible notice. Turn on labelling if the document is official or will be shared.',
          ),
    )
  }
  return checks
}

const CHECK_ORDER = [
  'can_export',
  'redaction',
  'redaction_elsewhere',
  'edits_visible',
  'amount_edits',
  'ocr_edits',
  'visual_covers',
  'hidden_regions',
  'modified_label',
  'document_features',
  'committed_only',
  'pdfjs_reopen',
  'reopen_file',
  'page_count',
  'page_layout',
  'content_preserved',
  'untouched_pages',
  'committed_edits',
  'no_editor_chrome',
  'valid_objects',
] as const

function finalize(
  checks: ExportQualityCheckItem[],
  exportResult: ExportEditedPdfResult | null,
  blockingMessage: string | null,
  limitations: readonly string[],
  excluded: readonly ExcludedOperation[],
): ExportQualityReport {
  const orderIndex = (id: string): number => {
    const index = CHECK_ORDER.indexOf(id as (typeof CHECK_ORDER)[number])
    return index < 0 ? CHECK_ORDER.length : index
  }
  const sorted = [...checks].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const hasFailure = sorted.some((entry) => entry.status === 'failed')
  return {
    checks: sorted,
    canDownload: Boolean(exportResult) && !hasFailure,
    exportResult,
    blockingMessage,
    limitations: exportResult?.limitations ?? limitations,
    excluded,
  }
}

export function exportQualitySummary(report: ExportQualityReport): {
  passed: number
  warning: number
  failed: number
  notChecked: number
} {
  let passed = 0
  let warning = 0
  let failed = 0
  let notChecked = 0
  for (const check of report.checks) {
    switch (check.status) {
      case 'passed':
        passed += 1
        break
      case 'warning':
        warning += 1
        break
      case 'failed':
        failed += 1
        break
      case 'not_checked':
        notChecked += 1
        break
      default:
        break
    }
  }
  return { passed, warning, failed, notChecked }
}
