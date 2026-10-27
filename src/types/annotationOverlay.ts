import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'

/**
 * A comment on part of the page. Exported as a standard PDF annotation (outline plus
 * note), so the page content itself is not changed and readers can hide or delete it.
 */
export interface AnnotationOverlayObject {
  readonly id: EditingObjectId
  readonly kind: 'annotation'
  readonly pageIndex: number
  /** PDF user space. */
  readonly bounds: PageRect
  readonly note: string
  /** Outline colour (hex). */
  readonly color: string
  readonly createdAt: number
  readonly updatedAt: number
}

export type AnnotationOverlayPatch = Partial<Pick<AnnotationOverlayObject, 'bounds' | 'note' | 'color'>>

export const ANNOTATION_COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#16a34a', '#7c3aed'] as const
