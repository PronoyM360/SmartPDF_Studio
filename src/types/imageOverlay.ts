import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'

export interface ImageOverlayObject {
  readonly id: EditingObjectId
  readonly kind: 'image'
  readonly pageIndex: number
  readonly bounds: PageRect
  readonly assetId: string
  readonly rotation: number
  readonly lockAspectRatio: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export type ImageOverlayPatch = Partial<
  Pick<ImageOverlayObject, 'bounds' | 'rotation' | 'lockAspectRatio'>
>
