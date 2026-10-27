import { useMemo } from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import {
  buildTrackedChanges,
  countTrackedChanges,
  type TrackedChange,
  type TrackedChangeCounts,
} from '@/lib/changes/trackedChanges'
import {
  describeExportedModifications,
  exportableOverlayObjects,
  requiresModifiedCopyLabel,
  summarizeModifications,
} from '@/lib/redaction/maskModes'

export interface TrackedChangesState {
  readonly changes: readonly TrackedChange[]
  readonly counts: TrackedChangeCounts
  /** Null when undo removed the change, so stale outlines disappear. */
  readonly focusedChange: TrackedChange | null
  /** The download would differ from the original upload. */
  readonly exportIsModified: boolean
  /** The download is always labelled "Modified copy" (amounts or scanned text changed). */
  readonly modifiedLabelRequired: boolean
}

/** Changes derived from the committed overlays — the same data the export draws. */
export function useTrackedChanges(): TrackedChangesState {
  const { overlayObjects } = useEditorSession()
  const { focusedChangeId } = useEditorPreview()

  return useMemo(() => {
    const changes = buildTrackedChanges(overlayObjects)
    const modifications = summarizeModifications(exportableOverlayObjects(overlayObjects))
    return {
      changes,
      counts: countTrackedChanges(changes),
      focusedChange: changes.find((change) => change.id === focusedChangeId) ?? null,
      exportIsModified: describeExportedModifications(modifications) !== null,
      modifiedLabelRequired: requiresModifiedCopyLabel(modifications),
    }
  }, [overlayObjects, focusedChangeId])
}
