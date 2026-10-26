import type { TextAlignment } from '@/types/textOverlay'
import type { ExtractedPdfTextItem } from '@/types/pdfTextInspection'
import type { PageRect } from '@/types'
import { mapPdfFontName } from '@/lib/pdf/mapPdfFontName'
import type { PdfRectColorSample } from '@/lib/pdf/samplePdfRectColors'

export type TextEditFidelityStatus =
  | 'original_style_matched'
  | 'approximate_font_match'
  | 'ocr_assisted'
  | 'background_reconstruction_required'
  | 'visual_verification_recommended'

export interface TextReplacementPlan {
  readonly maskBounds: PageRect
  readonly textBounds: PageRect
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: 'normal' | 'bold'
  readonly color: string
  readonly alignment: TextAlignment
  readonly maskFillColor: string
  readonly maskOpacity: number
  readonly fidelityStatus: TextEditFidelityStatus
  readonly fidelityNotes: readonly string[]
}

const DEFAULT_COLOR = '#0f172a'
const MAX_WIDTH_GROWTH_RATIO = 1.45

export function adjustTextBoundsForReplacement(
  bounds: PageRect,
  originalText: string,
  replacementText: string,
): PageRect {
  const original = originalText.trim()
  const replacement = replacementText.trim()
  if (!original || !replacement || replacement.length <= original.length) {
    return bounds
  }
  const ratio = replacement.length / original.length
  const width = bounds.width * Math.min(ratio, MAX_WIDTH_GROWTH_RATIO)
  return { ...bounds, width: Math.max(width, bounds.width) }
}

export function buildTextReplacementPlan(input: {
  item: ExtractedPdfTextItem
  replacementText: string
  bounds: PageRect
  colorSample: PdfRectColorSample | null
  editSource?: 'pdf_text' | 'ocr'
  /** When replacing a substring, use the matched text for width adjustment. */
  originalTextForSizing?: string
}): TextReplacementPlan {
  const {
    item,
    replacementText,
    bounds,
    colorSample,
    editSource = 'pdf_text',
    originalTextForSizing,
  } = input
  const mapped = mapPdfFontName(item.fontName)
  const fontSize = Math.min(
    Math.max(item.fontSizePt ?? bounds.height * 0.75, 6),
    120,
  )
  const textBounds = adjustTextBoundsForReplacement(
    bounds,
    originalTextForSizing ?? item.text,
    replacementText,
  )

  const padding = Math.max(1.5, fontSize * 0.08)
  const maskBounds: PageRect = {
    x: Math.max(0, textBounds.x - padding),
    y: Math.max(0, textBounds.y - padding),
    width: textBounds.width + padding * 2,
    height: textBounds.height + padding * 2,
  }

  const fidelityNotes: string[] = [
    'Original PDF text remains in the file under the cover mask.',
    'This is a visual overlay correction, not native text stream editing.',
  ]

  let fidelityStatus: TextEditFidelityStatus = 'visual_verification_recommended'
  let maskFillColor = '#ffffff'
  let maskOpacity = 1
  let color = colorSample?.textColor ?? DEFAULT_COLOR

  if (editSource === 'ocr') {
    fidelityStatus = 'ocr_assisted'
    fidelityNotes.push('OCR-assisted region — font and color are approximate.')
  } else if (item.positionReliability === 'low') {
    fidelityStatus = 'visual_verification_recommended'
    fidelityNotes.push('Detected text position has low confidence.')
  } else if (!mapped.isExactFamilyMatch) {
    fidelityStatus = 'approximate_font_match'
    fidelityNotes.push(
      `PDF font "${item.fontName}" maps to "${mapped.family}" for overlay/export.`,
    )
  } else if (colorSample?.textColor && colorSample.backgroundKind === 'solid') {
    fidelityStatus = 'original_style_matched'
    fidelityNotes.push(
      'Font size and colors were taken from the PDF preview where sampling succeeded.',
    )
  } else if (mapped.isExactFamilyMatch && item.fontSizePt) {
    fidelityStatus = 'approximate_font_match'
    fidelityNotes.push(
      'Font family matched by name; color sampling was partial or unavailable.',
    )
  }

  if (colorSample?.backgroundKind === 'complex') {
    fidelityStatus = 'background_reconstruction_required'
    maskOpacity = 0.97
    fidelityNotes.push(
      'Complex background — flat mask may look incorrect. Preview before applying.',
    )
  } else if (colorSample?.backgroundColor) {
    maskFillColor = colorSample.backgroundColor
  }

  if (colorSample?.notes.length) {
    fidelityNotes.push(...colorSample.notes)
  }

  if (!colorSample?.textColor) {
    color = DEFAULT_COLOR
  }

  return {
    maskBounds,
    textBounds,
    fontFamily: mapped.family,
    fontSize,
    fontWeight: mapped.weight,
    color,
    alignment: 'left',
    maskFillColor,
    maskOpacity,
    fidelityStatus,
    fidelityNotes,
  }
}

export function fidelityStatusLabel(status: TextEditFidelityStatus): string {
  switch (status) {
    case 'original_style_matched':
      return 'Original style closely matched (overlay)'
    case 'approximate_font_match':
      return 'Approximate font match'
    case 'ocr_assisted':
      return 'OCR-assisted edit'
    case 'background_reconstruction_required':
      return 'Background reconstruction limited'
    case 'visual_verification_recommended':
      return 'Visual verification recommended'
    default:
      return 'Visual verification recommended'
  }
}
