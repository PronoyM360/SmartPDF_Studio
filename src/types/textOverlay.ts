import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'

export type TextAlignment = 'left' | 'center' | 'right'

/** Text overlay stored in PDF user space (origin bottom-left, units in points). */
export interface TextOverlayObject {
  readonly id: EditingObjectId
  readonly kind: 'text'
  readonly pageIndex: number
  /** Lower-left corner of the text box in PDF user space. */
  readonly bounds: PageRect
  readonly content: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly color: string
  /** When set, fills the text box on canvas and in exported PDFs. */
  readonly backgroundColor?: string
  readonly backgroundOpacity?: number
  readonly alignment: TextAlignment
  readonly fontWeight?: 'normal' | 'bold'
  readonly createdAt: number
  readonly updatedAt: number
}

export type TextOverlayPatch = Partial<
  Pick<
    TextOverlayObject,
    | 'bounds'
    | 'content'
    | 'fontFamily'
    | 'fontSize'
    | 'color'
    | 'backgroundColor'
    | 'backgroundOpacity'
    | 'alignment'
    | 'fontWeight'
  >
>
