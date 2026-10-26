/** Point in PDF page space (origin bottom-left in PDF user units). */
export interface PagePoint {
  readonly x: number
  readonly y: number
}

export interface PageRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Legacy viewport context — prefer `PageDisplayTransform` in `@/lib/pdf`. */
export interface PageCoordinateContext {
  readonly pageIndex: number
  readonly pageWidth: number
  readonly pageHeight: number
  readonly scale: number
}
