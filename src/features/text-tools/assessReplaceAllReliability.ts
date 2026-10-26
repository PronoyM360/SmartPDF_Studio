import type { PdfTextSearchResult } from '@/types/pdfTextInspection'

export interface ReplaceAllReliabilityAssessment {
  readonly reliable: boolean
  readonly reasons: readonly string[]
}

export function assessReplaceAllReliability(
  results: readonly PdfTextSearchResult[],
  replacementText: string,
): ReplaceAllReliabilityAssessment {
  if (!replacementText.trim()) {
    return { reliable: false, reasons: ['Enter replacement text before replacing all.'] }
  }
  if (results.length === 0) {
    return { reliable: false, reasons: ['No matches to replace.'] }
  }

  const reasons: string[] = []

  if (results.some((result) => result.textSource !== 'pdf_selectable')) {
    reasons.push(
      'One or more matches are not selectable PDF text. Use the OCR workflow for scanned content.',
    )
  }

  if (results.some((result) => result.positionReliability === 'low')) {
    reasons.push(
      'One or more matches have low position confidence — replace individually after adjusting the cover region.',
    )
  }

  const matchesPerItem = new Map<string, number>()
  for (const result of results) {
    matchesPerItem.set(result.itemId, (matchesPerItem.get(result.itemId) ?? 0) + 1)
  }
  if ([...matchesPerItem.values()].some((count) => count > 1)) {
    reasons.push(
      'Multiple matches share the same PDF text item. Replace each occurrence individually to avoid overlapping overlays.',
    )
  }

  return {
    reliable: reasons.length === 0,
    reasons,
  }
}
