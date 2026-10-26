import type {
  ExtractedPdfTextItem,
  TextReplacementAssessment,
} from '@/types/pdfTextInspection'
import { mapPdfFontName } from '@/lib/pdf/mapPdfFontName'

export function assessTextReplacementCapability(
  item: ExtractedPdfTextItem,
): TextReplacementAssessment {
  const mapped = mapPdfFontName(item.fontName)
  const reasons = [
    'PDF.js extracts text and geometry for inspection; it does not rewrite original content streams.',
    'Export adds new draw commands (mask + text). Original glyphs may remain recoverable.',
  ]

  if (item.positionReliability === 'low') {
    reasons.push(
      'Detected position for this text is uncertain — adjust the cover box before applying.',
    )
  }

  if (!mapped.isExactFamilyMatch) {
    reasons.push(
      `Embedded/complex font "${item.fontName}" will use approximate family "${mapped.family}" in overlays and export.`,
    )
  }

  if (/image|ocr|scan/i.test(item.fontName)) {
    reasons.push('This does not appear to be standard selectable PDF text.')
  }

  const mode =
    item.positionReliability === 'high' ? 'overlay_recommended' : 'native_not_available'

  const headline =
    mode === 'overlay_recommended'
      ? 'Overlay correction (recommended for selectable text)'
      : 'Low-confidence geometry — verify before applying'

  return {
    mode,
    headline,
    reasons,
  }
}
