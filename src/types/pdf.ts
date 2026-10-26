import type { PageRect } from './coordinates'

export type PdfDocumentId = string

/** Immutable snapshot of the user's original upload — never mutated by editing. */
export interface PdfSource {
  readonly name: string
  readonly byteLength: number
  readonly originalBytes: Uint8Array
}

export interface PdfPageMeta {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly rotation: 0 | 90 | 180 | 270
  readonly mediaBox: PageRect
}

export interface LoadedPdfDocument {
  readonly id: PdfDocumentId
  readonly source: PdfSource
  readonly pageCount: number
  readonly pages: readonly PdfPageMeta[]
}
