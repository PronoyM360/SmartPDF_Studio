import { maskModeOf } from '@/lib/redaction/maskModes'
import type { PageRect } from '@/types'
import type { MaskMode } from '@/types/maskOverlay'
import { isMaskOverlay, type OverlayObject } from '@/types/overlayObjects'

export type TrackedChangeKind =
  | 'section'
  | 'area'
  | 'text-replaced'
  | 'price-updated'
  | 'ocr-edit'
  | 'text-added'
  | 'image-added'
  | 'annotation-added'

/**
 * One user-visible edit, built only from what the overlays record about themselves.
 * Nothing here is inferred from pixels or from the PDF content.
 */
export interface TrackedChange {
  /** Id of the overlay that represents the change (the text for text edits). */
  readonly id: string
  readonly kind: TrackedChangeKind
  readonly pageIndex: number
  /** Union of all overlays in the change, PDF user space — same as export. */
  readonly bounds: PageRect
  readonly objectIds: readonly string[]
  readonly title: string
  readonly label?: string
  readonly before?: string
  readonly after?: string
  readonly maskMode?: MaskMode
  /** False for preview-only hides, which the download does not contain. */
  readonly inExport: boolean
  readonly note?: string
  readonly createdAt: number
}

const MASK_TITLES: Record<MaskMode, { section: string; area: string; note: string }> = {
  hide: {
    section: 'Section hidden',
    area: 'Area hidden',
    note: 'Preview only — the download still shows this content.',
  },
  cover: {
    section: 'Section covered',
    area: 'Area covered',
    note: 'Visual cover — the content stays in the file underneath.',
  },
  redact: {
    section: 'Section redacted',
    area: 'Area redacted',
    note: 'Removed from the page when you download.',
  },
}

function union(rects: readonly PageRect[]): PageRect {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  }
}

function clip(text: string, max = 48): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

export function buildTrackedChanges(overlays: readonly OverlayObject[]): TrackedChange[] {
  const byId = new Map(overlays.map((object) => [object.id, object]))
  const linkedMaskIds = new Set<string>()
  const changes: TrackedChange[] = []

  for (const object of overlays) {
    if (object.kind !== 'text') {
      continue
    }
    const maskId = object.amendment?.maskId ?? object.replacement?.maskId
    const mask = maskId ? byId.get(maskId) : undefined
    if (mask) {
      linkedMaskIds.add(mask.id)
    }
    const rects = mask ? [object.bounds, mask.bounds] : [object.bounds]
    const base = {
      id: object.id,
      pageIndex: object.pageIndex,
      bounds: union(rects),
      objectIds: mask ? [object.id, mask.id] : [object.id],
      after: clip(object.content),
      inExport: true,
      createdAt: object.createdAt,
    }
    if (object.amendment) {
      changes.push({
        ...base,
        kind: 'price-updated',
        title: 'Price updated',
        before: clip(object.amendment.originalText),
      })
    } else if (object.ocrEdit) {
      changes.push({
        ...base,
        kind: 'ocr-edit',
        title: 'Scanned text edited (OCR)',
        before: clip(object.replacement?.originalText ?? object.ocrEdit.recognizedText),
        note: 'Position, font and background are estimated from the scan.',
      })
    } else if (object.replacement) {
      changes.push({
        ...base,
        kind: 'text-replaced',
        title: 'Text replaced',
        before: clip(object.replacement.originalText),
        note: 'The original text stays in the file under the cover.',
      })
    } else {
      changes.push({ ...base, kind: 'text-added', title: 'Text added' })
    }
  }

  for (const object of overlays) {
    if (object.kind === 'image') {
      changes.push({
        id: object.id,
        kind: 'image-added',
        pageIndex: object.pageIndex,
        bounds: object.bounds,
        objectIds: [object.id],
        title: 'Image added',
        inExport: true,
        createdAt: object.createdAt,
      })
      continue
    }
    if (object.kind === 'annotation') {
      changes.push({
        id: object.id,
        kind: 'annotation-added',
        pageIndex: object.pageIndex,
        bounds: object.bounds,
        objectIds: [object.id],
        title: 'Annotation added',
        ...(object.note.trim() ? { after: clip(object.note) } : {}),
        inExport: true,
        note: 'Added as a PDF comment; the page content is not changed.',
        createdAt: object.createdAt,
      })
      continue
    }
    if (!isMaskOverlay(object) || linkedMaskIds.has(object.id)) {
      continue
    }
    const mode = maskModeOf(object)
    // Only masks applied to a detected or saved section count as section changes;
    // free selections and drawn masks are areas.
    const isSection = Boolean(object.sourceSectionId)
    changes.push({
      id: object.id,
      kind: isSection ? 'section' : 'area',
      pageIndex: object.pageIndex,
      bounds: object.bounds,
      objectIds: [object.id],
      title: isSection ? MASK_TITLES[mode].section : MASK_TITLES[mode].area,
      ...(object.label ? { label: clip(object.label) } : {}),
      maskMode: mode,
      inExport: mode !== 'hide',
      note: MASK_TITLES[mode].note,
      createdAt: object.createdAt,
    })
  }

  return changes.sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt)
}

export interface TrackedChangeCounts {
  readonly total: number
  readonly inExport: number
  readonly byKind: Readonly<Record<TrackedChangeKind, number>>
  /** 1-based page numbers with at least one change. */
  readonly pages: readonly number[]
}

export function countTrackedChanges(changes: readonly TrackedChange[]): TrackedChangeCounts {
  const byKind: Record<TrackedChangeKind, number> = {
    section: 0,
    area: 0,
    'text-replaced': 0,
    'price-updated': 0,
    'ocr-edit': 0,
    'text-added': 0,
    'image-added': 0,
    'annotation-added': 0,
  }
  for (const change of changes) {
    byKind[change.kind] += 1
  }
  return {
    total: changes.length,
    inExport: changes.filter((change) => change.inExport).length,
    byKind,
    pages: [...new Set(changes.map((change) => change.pageIndex + 1))].sort((a, b) => a - b),
  }
}

export const TRACKED_CHANGE_LABELS: Record<TrackedChangeKind, string> = {
  section: 'Sections',
  area: 'Masked areas',
  'text-replaced': 'Text replaced',
  'price-updated': 'Prices updated',
  'ocr-edit': 'OCR edits',
  'text-added': 'Text added',
  'image-added': 'Images added',
  'annotation-added': 'Annotations',
}
