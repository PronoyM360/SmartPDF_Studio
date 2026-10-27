import type { OcrEditRecord } from './backgroundRepair'
import type { PageRect } from './coordinates'
import type { EditingObjectId } from './editingObjects'
import type { AmountAmendment } from './priceEditing'

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
  /** Extra space after each character, in PDF points. */
  readonly letterSpacing?: number
  /** Set when this overlay replaces a printed amount (marks the export as a modified copy). */
  readonly amendment?: AmountAmendment
  /** Set when this overlay replaces text recognised by OCR inside an image. */
  readonly ocrEdit?: OcrEditRecord
  /** Set when this overlay replaces existing page text (PDF text or OCR) behind a cover. */
  readonly replacement?: TextReplacementRecord
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TextReplacementRecord {
  /** The page text this overlay covers, as confirmed by the user. */
  readonly originalText: string
  /** The cover mask created together with this overlay. */
  readonly maskId: string
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
