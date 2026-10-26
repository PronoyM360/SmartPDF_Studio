import type { PageRect } from './coordinates'

export type EditingObjectId = string

export type EditingObjectKind = 'text' | 'image' | 'annotation'

interface BaseEditingObject {
  readonly id: EditingObjectId
  readonly kind: EditingObjectKind
  readonly pageIndex: number
  readonly bounds: PageRect
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TextEditingObject extends BaseEditingObject {
  readonly kind: 'text'
  readonly content: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly color: string
  readonly alignment: 'left' | 'center' | 'right'
}

export interface ImageEditingObject extends BaseEditingObject {
  readonly kind: 'image'
  readonly assetRef: string
}

export interface AnnotationEditingObject extends BaseEditingObject {
  readonly kind: 'annotation'
  readonly note: string
}

export type EditingObject =
  | TextEditingObject
  | ImageEditingObject
  | AnnotationEditingObject

/** Edits are applied on top of the original PDF bytes, not by rewriting the source. */
export interface EditingDocumentState {
  readonly documentId: string
  readonly objects: readonly EditingObject[]
}
