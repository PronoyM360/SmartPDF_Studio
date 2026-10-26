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

async function probeRenderExportedPdf(bytes: Uint8Array): Promise<{
  ok: boolean
  detail: string
}> {
  if (typeof document === 'undefined') {
    return { ok: false, detail: 'Render probe skipped (no browser document).' }
  }
  let pdf
  try {
    const opened = await openPdfDocument(bytes.slice())
    pdf = opened.pdf
    const page = await pdf.getPage(1)
    const canvas = document.createElement('canvas')
    await renderPdfPage({ page, canvas, scale: 0.5, devicePixelRatio: 1 }).promise
    await pdf.cleanup()
    return {
      ok: true,
      detail: 'First page rendered in this browser using PDF.js (approximate viewer check).',
    }
  } catch (cause) {
    if (pdf) {
      await pdf.cleanup().catch(() => undefined)
    }
    const message =
      cause instanceof Error ? cause.message : 'Could not render exported PDF.'
    return { ok: false, detail: message }
  }
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

  const validation = validateExportOverlays(
    options.overlays,
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

  const committedCount = options.overlays.length
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

  if (includeRender) {
    options.onProgress?.('Rendering export preview…')
    const render = await probeRenderExportedPdf(exportResult.bytes)
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

const CHECK_ORDER = [
  'can_export',
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
