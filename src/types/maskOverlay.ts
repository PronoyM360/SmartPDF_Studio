import type { MaskBackgroundPatch } from './backgroundRepair'
import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'

/**
 * cover  — opaque box drawn on top in the export; original content stays in the file.
 * hide   — editor preview only; never exported.
 * redact — on export the page is flattened to an image with this area burned in,
 *          so the underlying content is genuinely removed (verified after export).
 */
export type MaskMode = 'cover' | 'hide' | 'redact'

export interface MaskOverlayObject {
  readonly id: EditingObjectId
  readonly kind: 'mask'
  readonly pageIndex: number
  readonly bounds: PageRect
  readonly fillColor: string
  readonly opacity: number
  readonly createdAt: number
  readonly updatedAt: number
  /** Absent on masks created before modes existed; treated as `cover`. */
  readonly mode?: MaskMode
  /** Human-readable origin, e.g. the section name it was applied to. */
  readonly label?: string
  readonly sourceSectionId?: string
  /** Reconstructed background drawn instead of `fillColor` (OCR edits). */
  readonly backgroundPatch?: MaskBackgroundPatch
}

export type MaskOverlayPatch = Partial<
  Pick<MaskOverlayObject, 'bounds' | 'fillColor' | 'opacity' | 'mode' | 'label' | 'backgroundPatch'>
>
