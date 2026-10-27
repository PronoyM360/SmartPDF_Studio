import { buildTrackedChanges, type TrackedChange } from '@/lib/changes/trackedChanges'
import { maskModeOf } from '@/lib/redaction/maskModes'
import { isMaskOverlay, type OverlayKind, type OverlayObject } from '@/types/overlayObjects'

/**
 * hidden      — preview-only hide mask; never part of the download.
 * uncommitted — live change not yet recorded in the undo history (e.g. a slider
 *               still being dragged); the last committed version is exported instead.
 */
export type ExcludedOperationReason = 'hidden' | 'uncommitted'

export interface ExcludedOperation {
  readonly id: string
  readonly kind: OverlayKind
  readonly pageIndex: number
  readonly reason: ExcludedOperationReason
  /** True when an older committed version of the same object is exported. */
  readonly committedVersionExported: boolean
}

export interface ExportOperationSelection {
  /** Committed overlays that are drawn into the PDF. */
  readonly operations: readonly OverlayObject[]
  readonly excluded: readonly ExcludedOperation[]
  /** Tracked changes built from `operations` only. */
  readonly changes: readonly TrackedChange[]
}

export interface SelectExportOperationsInput {
  /** What the editor currently shows, including live edits not yet in the undo history. */
  readonly present: readonly OverlayObject[]
  /** Last snapshot recorded in the undo history. Defaults to `present`. */
  readonly committed?: readonly OverlayObject[]
}

/**
 * Export is built from committed editing operations only. Drafts (pending text
 * replacements, region selections, open price dialogs) never enter the overlay store,
 * so what remains to exclude are hidden previews and live edits not yet committed.
 */
export function selectExportOperations(input: SelectExportOperationsInput): ExportOperationSelection {
  const committed = input.committed ?? input.present
  const committedById = new Map(committed.map((object) => [object.id, object]))
  const excluded: ExcludedOperation[] = []

  for (const object of input.present) {
    const saved = committedById.get(object.id)
    if (!saved || saved.updatedAt !== object.updatedAt) {
      excluded.push({
        id: object.id,
        kind: object.kind,
        pageIndex: object.pageIndex,
        reason: 'uncommitted',
        committedVersionExported: Boolean(saved),
      })
    }
  }

  const operations: OverlayObject[] = []
  for (const object of committed) {
    if (isMaskOverlay(object) && maskModeOf(object) === 'hide') {
      excluded.push({
        id: object.id,
        kind: object.kind,
        pageIndex: object.pageIndex,
        reason: 'hidden',
        committedVersionExported: false,
      })
      continue
    }
    operations.push(object)
  }

  return { operations, excluded, changes: buildTrackedChanges(operations) }
}

export function describeExcludedOperations(excluded: readonly ExcludedOperation[]): string | null {
  const hidden = excluded.filter((entry) => entry.reason === 'hidden').length
  const live = excluded.filter((entry) => entry.reason === 'uncommitted')
  const parts: string[] = []
  if (live.length > 0) {
    const replaced = live.filter((entry) => entry.committedVersionExported).length
    parts.push(
      `${live.length} uncommitted edit(s) were left out${replaced > 0 ? ` (${replaced} exported in their last committed state)` : ''}`,
    )
  }
  if (hidden > 0) {
    parts.push(`${hidden} preview-only hidden region(s) are not part of the download`)
  }
  return parts.length > 0 ? `${parts.join('; ')}.` : null
}
