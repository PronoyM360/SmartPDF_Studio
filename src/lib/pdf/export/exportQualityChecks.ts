import { loadPdfLibDocument } from '@/lib/pdf/pdfLibBridge'
import { openPdfDocument } from '@/lib/pdf/openPdfDocument'
import { renderPdfPage } from '@/lib/pdf/renderPdfPage'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import {
  exportEditedPdf,
  ExportValidationError,
  type ExportEditedPdfResult,
} from '@/lib/pdf/export/exportEditedPdf'
import { validateExportOverlays } from '@/lib/pdf/export/validateExportOverlays'
import { comparePageFingerprints } from '@/lib/pdf/export/pageFingerprints'
import type { ImageBytesProvider } from '@/lib/pdf/export/drawOverlays'
import { openBrowserInspector } from '@/lib/redaction/browserPdfTools'
import {
  describeExportedModifications,
  exportableOverlayObjects,
  requiresModifiedCopyLabel,
} from '@/lib/redaction/maskModes'
import type { OpenPdfInspector } from '@/lib/redaction/types'
import { MIN_FILL_COVERAGE } from '@/lib/redaction/verifyRedactedExport'

export type ExportQualityCheckStatus = 'passed' | 'warning' | 'failed' | 'not_checked'

export interface ExportQualityCheckItem {
  readonly id: string
  readonly title: string
  readonly status: ExportQualityCheckStatus
  readonly detail: string
  readonly approximate?: boolean
}

export interface ExportQualityReport {
  readonly checks: readonly ExportQualityCheckItem[]
  readonly canDownload: boolean
  readonly exportResult: ExportEditedPdfResult | null
  readonly blockingMessage: string | null
}

export interface RunExportQualityChecksOptions {
  source: PdfSource
  overlays: readonly OverlayObject[]
  getImageBytes: ImageBytesProvider
  expectedPageCount: number
  onProgress?: (message: string) => void
  /** When false (e.g. unit tests without canvas), skips PDF.js render probe. */
  includeRenderProbe?: boolean
  /** Adds a visible "Modified copy" notice to changed pages. */
  markModifiedPages?: boolean
  /** Defaults to the PDF.js + canvas inspector when a browser document exists. */
  openInspector?: OpenPdfInspector
}

function item(
  id: string,
  title: string,
  status: ExportQualityCheckStatus,
  detail: string,
  approximate = false,
): ExportQualityCheckItem {
  return { id, title, status, detail, approximate: approximate || undefined }
}

const MAX_RENDER_PROBE_PAGES = 6

/** Pages to render after export: every edited page (capped), or the first page. */
export function renderProbePages(overlays: readonly OverlayObject[], pageCount: number): number[] {
  const edited = [...new Set(overlays.map((object) => object.pageIndex))]
    .filter((index) => index >= 0 && index < pageCount)
    .sort((a, b) => a - b)
  return edited.length > 0 ? edited.slice(0, MAX_RENDER_PROBE_PAGES) : [0]
}

async function probeRenderExportedPdf(
  bytes: Uint8Array,
  pageIndices: readonly number[],
): Promise<{
  ok: boolean
  detail: string
}> {
  if (typeof document === 'undefined') {
    return { ok: false, detail: 'Render probe skipped (no browser document).' }
  }
  let pdf
  const canvas = document.createElement('canvas')
  try {
    const opened = await openPdfDocument(bytes.slice())
    pdf = opened.pdf
    for (const pageIndex of pageIndices) {
      const page = await pdf.getPage(pageIndex + 1)
      await renderPdfPage({ page, canvas, scale: 0.5, devicePixelRatio: 1 }).promise
      page.cleanup()
    }
    await pdf.cleanup()
    const list = pageIndices.map((index) => index + 1).join(', ')
    return {
      ok: true,
      detail: `Reopened the exported file and rendered page ${list} with PDF.js (approximate viewer check).`,
    }
  } catch (cause) {
    if (pdf) {
      await pdf.cleanup().catch(() => undefined)
    }
    const message =
      cause instanceof Error ? cause.message : 'Could not render exported PDF.'
    return { ok: false, detail: message }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
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

export async function runExportQualityChecks(
  options: RunExportQualityChecksOptions,
): Promise<ExportQualityReport> {
  const checks: ExportQualityCheckItem[] = []
  const includeRender = options.includeRenderProbe ?? true

  options.onProgress?.('Checking export readiness…')

  let pageCount = options.expectedPageCount
  try {
    const doc = await loadPdfLibDocument(options.source)
    pageCount = doc.getPageCount()
  } catch (cause) {
    const detail =
      cause instanceof Error
        ? cause.message
        : 'The original PDF could not be loaded for export.'
    checks.push(item('can_export', 'PDF can be exported', 'failed', detail))
    return finalize(checks, null, detail)
  }

  const exportedOverlays = exportableOverlayObjects(options.overlays)
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
    return finalize(checks, null, validation.blockingErrors[0] ?? 'Export blocked.')
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

  const onlyOverlayKinds = options.overlays.every(
    (object) =>
      object.kind === 'text' || object.kind === 'image' || object.kind === 'mask',
  )
  checks.push(
    onlyOverlayKinds
      ? item(
          'no_editor_chrome',
          'Editing guides and selection handles excluded',
          'passed',
          'Committed data contains only exportable overlay types (text, image, mask). Handles are editor-only.',
        )
      : item(
          'no_editor_chrome',
          'Editing guides and selection handles excluded',
          'failed',
          'Unexpected overlay type in committed edits.',
        ),
  )

  if (committedCount === 0) {
    checks.push(
      item(
        'committed_edits',
        'Committed edits are present',
        'not_checked',
        'No overlays committed — export will match the original upload.',
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
      getImageBytes: options.getImageBytes,
      onProgress: options.onProgress,
      markModifiedPages: options.markModifiedPages,
      openInspector:
        options.openInspector ??
        (typeof document !== 'undefined' ? openBrowserInspector : undefined),
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
      return finalize(checks, null, cause.details[0] ?? 'Export failed.')
    }
    const detail =
      cause instanceof Error ? cause.message : 'Export failed for an unknown reason.'
    checks.push(item('can_export', 'PDF can be exported', 'failed', detail))
    return finalize(checks, null, detail)
  }

  const verification = exportResult.verification

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

  const layoutErrors = structure.errors.filter(
    (error) => !error.includes('Page count'),
  )
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
        'Page size and rotation match the source within tolerance.',
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

  if (includeRender) {
    options.onProgress?.('Rendering edited pages from the exported file…')
    const render = await probeRenderExportedPdf(
      exportResult.bytes,
      renderProbePages(validation.exportableOverlays, pageCount),
    )
    if (render.ok) {
      checks.push(
        item(
          'render_preview',
          'Exported PDF can be rendered for inspection',
          'passed',
          render.detail,
          true,
        ),
      )
    } else {
      checks.push(
        item(
          'render_preview',
          'Exported PDF can be rendered for inspection',
          'warning',
          render.detail,
          true,
        ),
      )
    }
  } else {
    checks.push(
      item(
        'render_preview',
        'Exported PDF can be rendered for inspection',
        'not_checked',
        'Render probe was not run in this environment.',
      ),
    )
  }

  return finalize(checks, exportResult, null)
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
            `Changed pages carry a small "Modified copy — ${described}" notice and the document keywords record the changes.`,
          )
        : item(
            'modified_label',
            'Exported copy is marked as modified',
            'warning',
            'The exported copy is not labelled as modified. Turn on labelling if the document is official or will be shared.',
          ),
    )
  }
  return checks
}

const CHECK_ORDER = [
  'can_export',
  'redaction',
  'redaction_elsewhere',
  'amount_edits',
  'ocr_edits',
  'visual_covers',
  'hidden_regions',
  'modified_label',
  'reopen_file',
  'page_count',
  'page_layout',
  'committed_edits',
  'no_editor_chrome',
  'valid_objects',
  'render_preview',
] as const

function finalize(
  checks: ExportQualityCheckItem[],
  exportResult: ExportEditedPdfResult | null,
  blockingMessage: string | null,
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
