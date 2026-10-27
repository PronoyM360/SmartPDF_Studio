import type { PageRect } from './coordinates'

export type OcrLanguagePackId = 'eng' | 'ben'

export interface OcrLanguagePackDefinition {
  readonly id: OcrLanguagePackId
  readonly label: string
  readonly tesseractCode: string
  readonly available: boolean
  readonly availabilityNote?: string
}

export type OcrTextKind = 'word' | 'line'

export type OcrTextTag = 'price' | 'quantity'

export interface OcrTextItem {
  readonly id: string
  readonly pageIndex: number
  readonly text: string
  readonly confidence: number
  readonly bounds: PageRect
  readonly kind: OcrTextKind
  readonly tags: readonly OcrTextTag[]
  /** Estimated from glyph geometry and the line baseline (absent on older results). */
  readonly fontSizePt?: number
  /**
   * Distance from the top of the item's on-screen box to the text baseline, in points.
   * Display-oriented, so it stays correct on rotated pages.
   */
  readonly baselineFromTopPt?: number
}

export type OcrGranularity = 'words' | 'lines'

export type PageContentKind = 'text' | 'image' | 'mixed' | 'empty'

export interface PageContentAssessment {
  readonly pageIndex: number
  readonly kind: PageContentKind
  /** Non-whitespace characters in the selectable text layer. */
  readonly textCharCount: number
  /** Share of the page covered by selectable text boxes (0–1). */
  readonly textAreaRatio: number
  /** Share of the page covered by painted images (0–1, overlaps counted once per image). */
  readonly imageAreaRatio: number
  readonly imageCount: number
  /** Pixels per PDF point of the largest image, i.e. its effective resolution / 72. */
  readonly dominantImagePixelsPerPoint: number | null
  readonly lowResolution: boolean
  readonly summary: string
}

export interface OcrPageResult {
  readonly pageIndex: number
  readonly languageId: OcrLanguagePackId
  readonly items: readonly OcrTextItem[]
  readonly ranAt: number
  readonly regionBounds: PageRect | null
}

export type OcrJobStatus = 'idle' | 'loading-worker' | 'rendering' | 'recognizing' | 'cancelled' | 'error' | 'done'

export interface OcrJobProgress {
  readonly status: OcrJobStatus
  readonly progress: number
  readonly message: string
  readonly error: string | null
}
