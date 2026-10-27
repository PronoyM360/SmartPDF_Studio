import type { TrackedChange, TrackedChangeKind } from '@/lib/changes/trackedChanges'
import { pageRectsIntersect } from '@/lib/pdf/pageRectIntersect'
import { maskModeOf } from '@/lib/redaction/maskModes'
import type { PageTextRun } from '@/lib/redaction/types'
import type { PageRect } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import { normalizeHexForColorInput } from './colorUtils'
import type { ExportPdfReader, OpenExportPdfReader, RenderedPage } from './exportPdfReader'
import { rectsMatch } from './pageFingerprints'
import { normalizePageRotation } from './rotationFrame'

export const EDIT_RENDER_SCALE = 1.5
export const PAGE_RENDER_SCALE = 0.5
/** Max per-channel difference before two pixels count as different. */
const PIXEL_TOLERANCE = 32
/** Share of changed pixels in an edited region that counts as a visible change. */
export const MIN_VISIBLE_CHANGE = 0.003
export const MIN_COVER_COVERAGE = 0.95
/** Untouched pages may differ by at most this share of pixels (rendering noise). */
export const MAX_UNTOUCHED_PIXEL_DIFFERENCE = 0.001
const MAX_UNTOUCHED_TEXT_PAGES = 60
const MAX_UNTOUCHED_RENDER_PAGES = 6
const MAX_EDITED_RENDER_PAGES = 12
const REGION_MARGIN_PT = 3

export type EditCheckStatus = 'verified' | 'warning' | 'failed' | 'not_checked'
export type EditCheckMethod = 'text' | 'render' | 'text+render' | 'annotation' | 'none'

export interface EditVerification {
  readonly changeId: string
  readonly kind: TrackedChangeKind
  readonly title: string
  readonly pageIndex: number
  readonly status: EditCheckStatus
  readonly method: EditCheckMethod
  readonly detail: string
}

export interface PageInspection {
  readonly pageIndex: number
  readonly edited: boolean
  readonly flattened: boolean
  /** Null when not compared (edited, flattened, or beyond the comparison cap). */
  readonly textMatchesOriginal: boolean | null
  /** Share of differing pixels vs the original render; null when not rendered. */
  readonly pixelDifference: number | null
}

export interface ExportInspection {
  readonly opened: boolean
  readonly error: string | null
  readonly originalPageCount: number
  readonly exportedPageCount: number
  readonly geometryErrors: readonly string[]
  readonly pages: readonly PageInspection[]
  readonly edits: readonly EditVerification[]
  readonly renderAvailable: boolean
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function compact(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase()
}

export function joinRuns(runs: readonly PageTextRun[]): string {
  return normalizeText(runs.map((run) => run.text).join(' '))
}

function expand(rect: PageRect, margin: number): PageRect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 }
}

function overlapShare(inner: PageRect, outer: PageRect): number {
  const width = Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x)
  const height = Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y)
  const area = inner.width * inner.height
  return width > 0 && height > 0 && area > 0 ? (width * height) / area : 0
}

/** Runs that lie at least half inside `rect`. */
export function runsInside(runs: readonly PageTextRun[], rect: PageRect): PageTextRun[] {
  return runs.filter((run) => overlapShare(run.bounds, rect) >= 0.5)
}

function runsTouching(runs: readonly PageTextRun[], rect: PageRect): PageTextRun[] {
  return runs.filter((run) => pageRectsIntersect(run.bounds, rect))
}

interface PixelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** PDF user-space rect → pixel box of an unrotated render, shrunk by `insetPx`. */
export function pixelBox(render: RenderedPage, rect: PageRect, insetPx = 0): PixelBox | null {
  const s = render.scale
  const top = render.view.y + render.view.height
  const x0 = Math.max(0, Math.ceil((rect.x - render.view.x) * s + insetPx))
  const x1 = Math.min(render.width, Math.floor((rect.x + rect.width - render.view.x) * s - insetPx))
  const y0 = Math.max(0, Math.ceil((top - (rect.y + rect.height)) * s + insetPx))
  const y1 = Math.min(render.height, Math.floor((top - rect.y) * s - insetPx))
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

/** Share (0–1) of pixels that differ between two renders, optionally inside `rect`. */
export function regionDifference(
  a: RenderedPage,
  b: RenderedPage,
  rect?: PageRect,
  tolerance = PIXEL_TOLERANCE,
): number | null {
  if (a.width !== b.width || a.height !== b.height) {
    return null
  }
  const box = rect ? pixelBox(a, rect) : { x0: 0, y0: 0, x1: a.width, y1: a.height }
  if (!box) {
    return null
  }
  let differing = 0
  let total = 0
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const index = (y * a.width + x) * 4
      const delta = Math.max(
        Math.abs(a.data[index]! - b.data[index]!),
        Math.abs(a.data[index + 1]! - b.data[index + 1]!),
        Math.abs(a.data[index + 2]! - b.data[index + 2]!),
      )
      if (delta > tolerance) {
        differing += 1
      }
      total += 1
    }
  }
  return total > 0 ? differing / total : null
}

/** Share (0–1) of pixels inside `rect` that match `fillColor`; edges are inset to skip anti-aliasing. */
export function regionFillCoverage(
  render: RenderedPage,
  rect: PageRect,
  fillColor: string,
  tolerance = 48,
): number | null {
  const box = pixelBox(render, rect, 1.5)
  if (!box) {
    return null
  }
  const body = normalizeHexForColorInput(fillColor, '#000000').slice(1)
  const r = Number.parseInt(body.slice(0, 2), 16)
  const g = Number.parseInt(body.slice(2, 4), 16)
  const b = Number.parseInt(body.slice(4, 6), 16)
  let matching = 0
  let total = 0
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      const index = (y * render.width + x) * 4
      const distance = Math.hypot(render.data[index]! - r, render.data[index + 1]! - g, render.data[index + 2]! - b)
      if (distance <= tolerance) {
        matching += 1
      }
      total += 1
    }
  }
  return total > 0 ? matching / total : null
}

export interface EditEvidence {
  readonly originalRuns: readonly PageTextRun[]
  readonly exportedRuns: readonly PageTextRun[]
  readonly originalRender: RenderedPage | null
  readonly exportedRender: RenderedPage | null
  readonly annotationsAdded: number
  readonly flattened: boolean
  /** Every exported operation on the same page. */
  readonly pageOperations: readonly OverlayObject[]
  /** Text the export itself drew (modified-copy notice). */
  readonly addedText?: string
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function quote(text: string, max = 40): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return `"${trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed}"`
}

function visibleChange(change: TrackedChange, evidence: EditEvidence): boolean | null {
  if (!evidence.originalRender || !evidence.exportedRender) {
    return null
  }
  const difference = regionDifference(evidence.originalRender, evidence.exportedRender, change.bounds)
  return difference === null ? null : difference >= MIN_VISIBLE_CHANGE
}

function result(
  change: TrackedChange,
  status: EditCheckStatus,
  method: EditCheckMethod,
  detail: string,
): EditVerification {
  return {
    changeId: change.id,
    kind: change.kind,
    title: change.title,
    pageIndex: change.pageIndex,
    status,
    method,
    detail,
  }
}

function evaluateTextEdit(change: TrackedChange, object: OverlayObject | undefined, evidence: EditEvidence): EditVerification {
  if (!object || object.kind !== 'text') {
    return result(change, 'not_checked', 'none', 'The edited text object was not found.')
  }
  const region = expand(change.bounds, REGION_MARGIN_PT)
  const exportedRegion = compact(runsTouching(evidence.exportedRuns, region).map((run) => run.text).join(''))
  const originalRegion = compact(runsTouching(evidence.originalRuns, region).map((run) => run.text).join(''))
  const lines = object.content.split('\n').map(compact).filter(Boolean)
  const textFound = lines.length > 0 && lines.every((line) => exportedRegion.includes(line))
  const alreadyThere = textFound && lines.every((line) => originalRegion.includes(line))
  const changed = visibleChange(change, evidence)

  let status: EditCheckStatus
  let method: EditCheckMethod
  let detail: string
  if (textFound && !alreadyThere) {
    status = changed === false ? 'warning' : 'verified'
    method = changed === true ? 'text+render' : 'text'
    detail =
      changed === false
        ? `${quote(object.content)} is in the text layer, but the area renders unchanged (check colour and size).`
        : `${quote(object.content)} found in the exported text layer${changed ? ' and the area renders differently' : ''}.`
  } else if (changed === true) {
    status = 'verified'
    method = 'render'
    detail = `The area renders differently from the original. ${quote(object.content)} is not extractable as text here (drawn as an image or with an unusual encoding), so the wording itself was not confirmed.`
  } else if (changed === false) {
    status = 'failed'
    method = 'render'
    detail = `${quote(object.content)} was not found and the area renders the same as the original.`
  } else {
    status = 'not_checked'
    method = 'none'
    detail = `${quote(object.content)} is not extractable here and pages could not be rendered to confirm it visually.`
  }

  const before = object.amendment?.originalText ?? object.replacement?.originalText
  if (before && !evidence.flattened && compact(before) && !lines.some((line) => line.includes(compact(before)))) {
    const stillThere = originalRegion.includes(compact(before)) && exportedRegion.includes(compact(before))
    if (stillThere) {
      if (status === 'verified') {
        status = 'warning'
      }
      detail += ` The original ${quote(before)} is still in the file underneath and can be copied or extracted — this is a visual replacement, not removal.`
    }
  }
  if (object.ocrEdit) {
    detail += ' The original scan pixels remain in the file under the patch.'
  }
  return result(change, status, method, detail)
}

function evaluateMask(change: TrackedChange, object: OverlayObject | undefined, evidence: EditEvidence): EditVerification {
  if (!object || object.kind !== 'mask') {
    return result(change, 'not_checked', 'none', 'The mask object was not found.')
  }
  const addedText = evidence.addedText ? normalizeText(evidence.addedText) : ''
  const notAdded = (run: PageTextRun) => !(addedText && addedText.includes(normalizeText(run.text)))
  const originalUnder = runsInside(evidence.originalRuns, object.bounds)
  const exportedUnder = runsInside(evidence.exportedRuns, object.bounds).filter(notAdded)
  const mode = maskModeOf(object)

  if (mode === 'redact') {
    const coverage = evidence.exportedRender
      ? regionFillCoverage(evidence.exportedRender, object.bounds, object.fillColor)
      : null
    if (exportedUnder.length > 0) {
      return result(
        change,
        'failed',
        'text',
        `${exportedUnder.length} text item(s) are still extractable inside the redacted area (e.g. ${quote(exportedUnder[0]!.text)}).`,
      )
    }
    if (coverage !== null && coverage < MIN_COVER_COVERAGE) {
      return result(change, 'failed', 'render', `Only ${percent(coverage)} of the redacted area renders in the fill colour.`)
    }
    return result(
      change,
      'verified',
      coverage !== null ? 'text+render' : 'text',
      `${originalUnder.length} original text item(s) in this area are gone from the text layer${coverage !== null ? ` and ${percent(coverage)} of the area renders filled` : ''}.`,
    )
  }

  // Covers drawn under new text or images are only partly the fill colour.
  const sharesArea = evidence.pageOperations.some(
    (other) => other.id !== object.id && other.kind !== 'mask' && other.kind !== 'annotation' && pageRectsIntersect(other.bounds, object.bounds),
  )
  let covered: boolean | null = null
  let coverageNote = ''
  if (object.backgroundPatch || sharesArea) {
    covered = visibleChange(change, evidence)
    coverageNote = covered ? 'The area renders differently from the original.' : ''
  } else if (evidence.exportedRender) {
    const coverage = regionFillCoverage(evidence.exportedRender, object.bounds, object.fillColor)
    covered = coverage === null ? null : coverage >= MIN_COVER_COVERAGE
    coverageNote = coverage === null ? '' : `${percent(coverage)} of the area renders in the cover colour.`
  }

  if (object.opacity < 1) {
    return result(
      change,
      'warning',
      covered === null ? 'none' : 'render',
      `The cover is ${percent(object.opacity)} opaque, so the content underneath stays visible. ${coverageNote}`.trim(),
    )
  }
  if (covered === false) {
    return result(change, 'failed', 'render', `The area is not fully covered in the rendered export. ${coverageNote}`.trim())
  }
  if (exportedUnder.length > 0) {
    return result(
      change,
      'warning',
      covered ? 'text+render' : 'text',
      `${coverageNote ? `${coverageNote} ` : ''}Hidden visually only: ${exportedUnder.length} text item(s) underneath remain extractable (e.g. ${quote(exportedUnder[0]!.text)}). This is not redaction.`,
    )
  }
  if (covered) {
    return result(change, 'verified', 'render', `${coverageNote} No extractable text lies under the cover.`)
  }
  return result(change, 'not_checked', 'none', 'Pages could not be rendered to confirm the cover visually. No extractable text lies under it.')
}

export function evaluateEdit(
  change: TrackedChange,
  object: OverlayObject | undefined,
  evidence: EditEvidence,
): EditVerification {
  switch (change.kind) {
    case 'price-updated':
    case 'text-replaced':
    case 'text-added':
    case 'ocr-edit':
      return evaluateTextEdit(change, object, evidence)
    case 'section':
    case 'area':
      return evaluateMask(change, object, evidence)
    case 'image-added': {
      const changed = visibleChange(change, evidence)
      if (changed === null) {
        return result(change, 'not_checked', 'none', 'Pages could not be rendered to confirm the image visually.')
      }
      return changed
        ? result(change, 'verified', 'render', 'The image area renders differently from the original.')
        : result(change, 'warning', 'render', 'The image area renders the same as the original; the image may be blank or match the page.')
    }
    case 'annotation-added': {
      const expected = evidence.pageOperations.filter((other) => other.kind === 'annotation').length
      return evidence.annotationsAdded >= expected
        ? result(change, 'verified', 'annotation', 'The comment annotation is present when the file is reopened.')
        : result(change, 'failed', 'annotation', 'The comment annotation is missing from the reopened file.')
    }
    default:
      return result(change, 'not_checked', 'none', 'This kind of change is not checked.')
  }
}

export interface InspectExportedPdfInput {
  readonly originalBytes: Uint8Array
  readonly exportedBytes: Uint8Array
  readonly operations: readonly OverlayObject[]
  readonly changes: readonly TrackedChange[]
  readonly flattenedPages: ReadonlySet<number>
  readonly addedTextByPage: ReadonlyMap<number, string>
  readonly openReader: OpenExportPdfReader
  readonly onProgress?: (message: string) => void
}

function failedInspection(error: string, originalPageCount = 0, exportedPageCount = 0): ExportInspection {
  return {
    opened: false,
    error,
    originalPageCount,
    exportedPageCount,
    geometryErrors: [],
    pages: [],
    edits: [],
    renderAvailable: false,
  }
}

/**
 * Reopens the exported bytes with PDF.js (the app's renderer) next to the original
 * and checks geometry, untouched pages and the visibility of each committed edit.
 * Text and pixel checks are heuristics; they cannot prove identical rendering
 * in every viewer.
 */
export async function inspectExportedPdf(input: InspectExportedPdfInput): Promise<ExportInspection> {
  let exported: ExportPdfReader | null = null
  let original: ExportPdfReader | null = null
  try {
    try {
      exported = await input.openReader(input.exportedBytes.slice())
    } catch (cause) {
      return failedInspection(
        `PDF.js could not open the exported file: ${cause instanceof Error ? cause.message : 'unknown error'}.`,
      )
    }
    try {
      original = await input.openReader(input.originalBytes.slice())
    } catch {
      return { ...failedInspection('The original could not be reopened for comparison.', 0, exported.pageCount), opened: true }
    }

    const count = Math.min(original.pageCount, exported.pageCount)
    const geometryErrors: string[] = []
    if (original.pageCount !== exported.pageCount) {
      geometryErrors.push(`PDF.js reads ${exported.pageCount} page(s) in the export but ${original.pageCount} in the original.`)
    }

    const editedPages = new Set<number>([
      ...input.operations.map((object) => object.pageIndex),
      ...input.addedTextByPage.keys(),
    ])
    const pages: PageInspection[] = []
    let renderAvailable = false
    let comparedText = 0
    let comparedRenders = 0

    for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
      const [before, after] = await Promise.all([original.readGeometry(pageIndex), exported.readGeometry(pageIndex)])
      if (!rectsMatch(before.view, after.view)) {
        geometryErrors.push(
          `Page ${pageIndex + 1} visible area differs in PDF.js (${before.view.width.toFixed(1)}×${before.view.height.toFixed(1)} → ${after.view.width.toFixed(1)}×${after.view.height.toFixed(1)} pt).`,
        )
      }
      if (normalizePageRotation(before.rotation) !== normalizePageRotation(after.rotation)) {
        geometryErrors.push(`Page ${pageIndex + 1} rotation differs in PDF.js (${before.rotation}° → ${after.rotation}°).`)
      }

      const edited = editedPages.has(pageIndex)
      const flattened = input.flattenedPages.has(pageIndex)
      let textMatchesOriginal: boolean | null = null
      let pixelDifference: number | null = null
      if (!edited && !flattened) {
        if (comparedText < MAX_UNTOUCHED_TEXT_PAGES) {
          comparedText += 1
          const [a, b] = await Promise.all([original.readContent(pageIndex), exported.readContent(pageIndex)])
          textMatchesOriginal = joinRuns(a.text) === joinRuns(b.text)
        }
        if (comparedRenders < MAX_UNTOUCHED_RENDER_PAGES) {
          comparedRenders += 1
          input.onProgress?.(`Comparing untouched page ${pageIndex + 1} with the original…`)
          const [a, b] = await Promise.all([
            original.renderPage(pageIndex, PAGE_RENDER_SCALE),
            exported.renderPage(pageIndex, PAGE_RENDER_SCALE),
          ])
          if (a && b) {
            renderAvailable = true
            pixelDifference = regionDifference(a, b)
          }
        }
      }
      pages.push({ pageIndex, edited, flattened, textMatchesOriginal, pixelDifference })
    }

    const operationsById = new Map(input.operations.map((object) => [object.id, object]))
    const changesByPage = new Map<number, TrackedChange[]>()
    for (const change of input.changes) {
      if (change.inExport && change.pageIndex < count) {
        changesByPage.set(change.pageIndex, [...(changesByPage.get(change.pageIndex) ?? []), change])
      }
    }
    const edits: EditVerification[] = []
    let renderedEditPages = 0
    for (const [pageIndex, changes] of [...changesByPage].sort((a, b) => a[0] - b[0])) {
      input.onProgress?.(`Checking edits on page ${pageIndex + 1}…`)
      const [before, after] = await Promise.all([original.readContent(pageIndex), exported.readContent(pageIndex)])
      let originalRender: RenderedPage | null = null
      let exportedRender: RenderedPage | null = null
      if (renderedEditPages < MAX_EDITED_RENDER_PAGES) {
        renderedEditPages += 1
        ;[originalRender, exportedRender] = await Promise.all([
          original.renderPage(pageIndex, EDIT_RENDER_SCALE),
          exported.renderPage(pageIndex, EDIT_RENDER_SCALE),
        ])
        renderAvailable ||= Boolean(originalRender && exportedRender)
      }
      const evidence: EditEvidence = {
        originalRuns: before.text,
        exportedRuns: after.text,
        originalRender,
        exportedRender,
        annotationsAdded: after.annotationCount - before.annotationCount,
        flattened: input.flattenedPages.has(pageIndex),
        pageOperations: input.operations.filter((object) => object.pageIndex === pageIndex),
        addedText: input.addedTextByPage.get(pageIndex),
      }
      for (const change of changes) {
        edits.push(evaluateEdit(change, operationsById.get(change.id), evidence))
      }
    }

    return {
      opened: true,
      error: null,
      originalPageCount: original.pageCount,
      exportedPageCount: exported.pageCount,
      geometryErrors,
      pages,
      edits,
      renderAvailable,
    }
  } finally {
    await exported?.destroy().catch(() => undefined)
    await original?.destroy().catch(() => undefined)
  }
}
