import { computeSubstringMatchBounds } from '@/lib/pdf/computeSubstringMatchBounds'
import type { ExtractedPdfTextItem, PdfTextSearchResult } from '@/types/pdfTextInspection'

export function searchExtractedTextItems(
  items: readonly ExtractedPdfTextItem[],
  query: string,
): PdfTextSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  const results: PdfTextSearchResult[] = []
  for (const item of items) {
    const haystack = item.text.toLowerCase()
    let startIndex = 0
    while (startIndex < haystack.length) {
      const matchIndex = haystack.indexOf(normalizedQuery, startIndex)
      if (matchIndex < 0) {
        break
      }
      const matchEndIndex = matchIndex + normalizedQuery.length
      const matchText = item.text.slice(matchIndex, matchEndIndex)
      const matchBounds = computeSubstringMatchBounds(
        item.bounds,
        item.text,
        matchIndex,
        matchEndIndex,
      )
      results.push({
        id: `${item.id}-${matchIndex}`,
        pageIndex: item.pageIndex,
        itemId: item.id,
        matchText,
        matchStartIndex: matchIndex,
        matchEndIndex,
        matchBounds,
        context: item.text.trim(),
        bounds: item.bounds,
        positionReliability: item.positionReliability,
        textSource: 'pdf_selectable',
      })
      startIndex = matchIndex + normalizedQuery.length
    }
  }
  return results
}
