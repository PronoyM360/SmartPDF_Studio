import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'

export interface MaskOverlayObject {
  readonly id: EditingObjectId
  readonly kind: 'mask'
  readonly pageIndex: number
  readonly bounds: PageRect
  readonly fillColor: string
  readonly opacity: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type MaskOverlayPatch = Partial<
  Pick<MaskOverlayObject, 'bounds' | 'fillColor' | 'opacity'>
>
