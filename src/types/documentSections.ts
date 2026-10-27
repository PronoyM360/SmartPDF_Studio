import type { PageRect } from './coordinates'

export type SectionCategoryId =
  | 'passenger'
  | 'contact'
  | 'agency'
  | 'flight'
  | 'booking'
  | 'base_fare'
  | 'gross_fare'
  | 'tax'
  | 'total'
  | 'baggage'
  | 'terms'
  | 'other'

/** Where the section's text came from; `none` = manual region with no readable text yet. */
export type SectionTextSource = 'pdf_text' | 'ocr' | 'none'

export type SectionOrigin = 'auto' | 'manual'

export type SectionConfidence = 'high' | 'medium' | 'low'

/** Why the category was suggested. */
export type SectionEvidence =
  | 'heading'
  | 'field_label'
  | 'content'
  | 'layout'
  | 'manual'

/**
 * A detected or manually drawn region. Stored separately from the PDF and from
 * overlay objects — it never modifies the document.
 */
export interface DocumentSection {
  /** Stable for the same page/source/category/bounds, so re-detection keeps renames and selection. */
  readonly id: string
  readonly pageIndex: number
  /** PDF user space (bottom-left origin, unrotated page). */
  readonly bounds: PageRect
  /** Top/left in the page's reading frame at scale 1 (see `PageGeometry`), for ordering. */
  readonly displayTop: number
  readonly displayLeft: number
  readonly category: SectionCategoryId
  readonly suggestedLabel: string
  readonly origin: SectionOrigin
  readonly textSource: SectionTextSource
  readonly confidence: SectionConfidence
  readonly ambiguous: boolean
  readonly alternativeCategories: readonly SectionCategoryId[]
  readonly evidence: SectionEvidence
  readonly headingText: string | null
  readonly text: string
  readonly lineCount: number
  /** Mean Tesseract word confidence (0–100) when text came from OCR. */
  readonly ocrConfidence: number | null
}

/** One positioned run of text fed into detection (PDF.js item or OCR word). */
export interface SectionTextRun {
  readonly text: string
  /** PDF user space. */
  readonly bounds: PageRect
  readonly fontSizePt: number | null
  /** OCR confidence 0–100; null for selectable PDF text. */
  readonly confidence: number | null
}

export type PageOcrState = 'not_run' | 'running' | 'done' | 'error' | 'cancelled'

export interface PageSectionAnalysis {
  readonly pageIndex: number
  readonly status: 'analyzing' | 'done' | 'error'
  readonly rotation: number
  readonly textRunCount: number
  readonly textCharCount: number
  /** null when the operator list could not be inspected. */
  readonly hasImages: boolean | null
  readonly ocr: PageOcrState
  readonly ocrWordCount: number
  readonly error: string | null
}
