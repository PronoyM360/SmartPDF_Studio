import type { PageRect } from './coordinates'

export type TextPositionReliability = 'high' | 'low'

export interface ExtractedPdfTextItem {
  readonly id: string
  readonly pageIndex: number
  readonly text: string
  readonly bounds: PageRect
  readonly fontName: string
  /** Font size in PDF points when derived from the text transform. */
  readonly fontSizePt: number
  readonly positionReliability: TextPositionReliability
  /** Baseline direction in PDF user space, degrees counter-clockwise (0 = left-to-right). */
  readonly directionDeg?: number
}

export type PdfTextSource = 'pdf_selectable' | 'ocr'

export interface PdfTextSearchResult {
  readonly id: string
  readonly pageIndex: number
  readonly itemId: string
  readonly matchText: string
  readonly matchStartIndex: number
  readonly matchEndIndex: number
  /** Highlight / cover region for this match (substring when partial). */
  readonly matchBounds: PageRect
  readonly context: string
  /** Full PDF.js text item bounds. */
  readonly bounds: PageRect
  readonly positionReliability: TextPositionReliability
  readonly textSource: PdfTextSource
}

export type TextReplacementMode = 'overlay_recommended' | 'native_not_available'

export interface TextReplacementAssessment {
  readonly mode: TextReplacementMode
  readonly headline: string
  readonly reasons: readonly string[]
}
