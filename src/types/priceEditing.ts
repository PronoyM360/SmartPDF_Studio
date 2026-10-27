import type { PagePoint, PageRect } from './coordinates'

export type PriceRole =
  | 'base_fare'
  | 'gross_fare'
  | 'net_fare'
  | 'tax'
  | 'surcharge'
  | 'service_charge'
  | 'discount'
  | 'subtotal'
  | 'total'
  | 'amount_paid'
  | 'other'

export type PriceTextSource = 'pdf_text' | 'ocr'

export type PriceDetectionConfidence = 'high' | 'medium' | 'low'

export type PriceAlignment = 'left' | 'center' | 'right'

/** One run of text (PDF.js item or OCR word) that price detection reads from. */
export interface PriceTextRun {
  readonly id: string
  readonly pageIndex: number
  readonly text: string
  /** PDF user space (bottom-left origin). */
  readonly bounds: PageRect
  readonly fontName: string
  readonly fontSizePt: number
  /** Text origin from the PDF text matrix; null when estimated (OCR). */
  readonly baseline: PagePoint | null
  /** Advance width of the whole run in PDF points, when PDF.js reports it. */
  readonly advanceWidth: number | null
  readonly directionDeg: number
  readonly positionReliability: 'high' | 'low'
  readonly source: PriceTextSource
  /** Tesseract confidence 0–100 for OCR runs. */
  readonly ocrConfidence: number | null
}

export type CurrencyPosition = 'prefix' | 'suffix'

export type NegativeStyle = 'minus' | 'parentheses' | 'trailing_minus'

export interface ParsedAmount {
  readonly raw: string
  /** Signed numeric value. */
  readonly value: number
  /** Currency marker exactly as written ("$", "BDT", "Tk."), if any. */
  readonly currency: string | null
  readonly currencyPosition: CurrencyPosition | null
  /** Whitespace between currency and number, as written. */
  readonly currencyGap: string
  readonly groupSeparator: string | null
  /** `indian` = 1,23,45,678 grouping. */
  readonly groupStyle: 'western' | 'indian' | null
  readonly decimalSeparator: '.' | ',' | null
  readonly fractionDigits: number
  readonly negativeStyle: NegativeStyle | null
  /** Text after the number such as "/-" or ".-". */
  readonly trailingMark: string
}

export type PriceLabelPlacement = 'inline' | 'left' | 'above'

export interface PriceCandidate {
  /** Stable across re-scans: page, source, position and text. */
  readonly id: string
  readonly pageIndex: number
  readonly source: PriceTextSource
  readonly runId: string
  readonly runText: string
  /** Character range of the amount inside `runText`. */
  readonly startIndex: number
  readonly endIndex: number
  /** The amount as printed, including currency and sign. */
  readonly text: string
  readonly amount: ParsedAmount
  /** PDF user space bounds of the amount only. */
  readonly bounds: PageRect
  readonly baseline: PagePoint | null
  readonly role: PriceRole
  /** Nearby label text, e.g. "Gross Fare". */
  readonly label: string | null
  readonly labelPlacement: PriceLabelPlacement | null
  readonly confidence: PriceDetectionConfidence
  readonly reasons: readonly string[]
  readonly fontName: string
  readonly fontSizePt: number
  readonly ocrConfidence: number | null
  /** How many candidates in the scanned pages print the same numeric value (including this one). */
  readonly duplicateCount: number
  readonly editable: boolean
  readonly blockedReason: string | null
}

export interface RejectedPriceToken {
  readonly pageIndex: number
  readonly text: string
  readonly reason: string
}

/** Committed amount edit, stored on the replacement text overlay. */
export interface AmountAmendment {
  readonly kind: 'amount'
  readonly targetKey: string
  readonly pageIndex: number
  readonly originalText: string
  readonly replacementText: string
  readonly originalValue: number
  readonly replacementValue: number | null
  readonly role: PriceRole
  readonly label: string | null
  readonly source: PriceTextSource
  readonly fontMatch: 'embedded_verified' | 'approximate'
  /** System font used when the PDF's embedded font is not loaded (e.g. after a reload). */
  readonly fallbackFontFamily: string
  readonly fallbackFontWeight: 'normal' | 'bold'
  /** Original baseline in PDF user space; vector export draws on it exactly. */
  readonly baselineY: number | null
  /** Mask overlay that covers the original value. */
  readonly maskId: string
}
