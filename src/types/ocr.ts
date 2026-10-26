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
