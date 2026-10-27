import type { OverlayTextCorrectionInput } from '@/features/pdf-editor/EditorSessionContext'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'

/** Maps an approved replacement plan to the same payload used for commit and export overlays. */
export function planToOverlayCorrectionInput(input: {
  pageIndex: number
  originalText: string
  replacementText: string
  plan: TextReplacementPlan
  editSource?: 'pdf_text' | 'ocr'
}): OverlayTextCorrectionInput {
  const { pageIndex, originalText, replacementText, plan, editSource = 'pdf_text' } =
    input
  return {
    pageIndex,
    bounds: plan.textBounds,
    maskBounds: plan.maskBounds,
    originalText,
    replacementText: replacementText.trim(),
    fontSizeHint: plan.fontSize,
    fontFamily: plan.fontFamily,
    color: plan.color,
    alignment: plan.alignment,
    fontWeight: plan.fontWeight,
    maskFillColor: plan.maskFillColor,
    maskOpacity: plan.maskOpacity,
    editSource,
    ...(plan.letterSpacing ? { letterSpacing: plan.letterSpacing } : {}),
  }
}
