import type { OverlayTextCorrectionInput } from '@/features/pdf-editor/EditorSessionContext'
import { buildTextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import type { ExtractedPdfTextItem, PdfTextSearchResult } from '@/types/pdfTextInspection'
import type { PdfRectColorSample } from '@/lib/pdf/samplePdfRectColors'

export function replacementTextForSearchMatch(
  itemText: string,
  result: PdfTextSearchResult,
  newMatchText: string,
): string {
  return (
    itemText.slice(0, result.matchStartIndex) +
    newMatchText +
    itemText.slice(result.matchEndIndex)
  )
}

export function buildOverlayCorrectionForSearchMatch(input: {
  item: ExtractedPdfTextItem
  result: PdfTextSearchResult
  replacementMatchText: string
  colorSample: PdfRectColorSample | null
}): OverlayTextCorrectionInput {
  const { item, result, replacementMatchText, colorSample } = input
  const bounds = result.matchBounds
  const plan = buildTextReplacementPlan({
    item,
    replacementText: replacementMatchText,
    bounds,
    colorSample,
    editSource: 'pdf_text',
    originalTextForSizing: result.matchText,
  })
  return planToOverlayCorrectionInput({
    pageIndex: item.pageIndex,
    originalText: result.matchText,
    replacementText: replacementMatchText,
    plan,
    editSource: 'pdf_text',
  })
}
