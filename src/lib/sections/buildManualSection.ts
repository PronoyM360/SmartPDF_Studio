import {
  inferCategoryFromContent,
  matchSectionLabel,
} from '@/lib/sections/classifySectionText'
import {
  groupRunsIntoSegments,
  segmentsToText,
  type LayoutRun,
} from '@/lib/sections/layoutTextLines'
import { getSectionCategory } from '@/lib/sections/sectionCategories'
import type { PageRect } from '@/types'
import type {
  DocumentSection,
  SectionCategoryId,
  SectionConfidence,
  SectionTextRun,
  SectionTextSource,
} from '@/types/documentSections'

export interface ManualSectionInput {
  readonly id: string
  readonly pageIndex: number
  /** PDF user space. */
  readonly bounds: PageRect
  readonly runs: readonly SectionTextRun[]
  readonly textSource: SectionTextSource
  readonly toDisplayRect: (pdfRect: PageRect) => PageRect
  readonly ordinal: number
}

/** User-drawn region; the category is only a suggestion from whatever text is inside. */
export function buildManualSection(input: ManualSectionInput): DocumentSection {
  const display = input.toDisplayRect(input.bounds)
  const layoutRuns: LayoutRun[] = input.runs.map((run) => {
    const rect = input.toDisplayRect(run.bounds)
    return {
      text: run.text,
      rect,
      fontSize: run.fontSizePt && run.fontSizePt > 0 ? run.fontSizePt : rect.height * 0.85,
      confidence: run.confidence,
    }
  })
  const segments = groupRunsIntoSegments(layoutRuns)
  const text = segmentsToText(segments)

  let category: SectionCategoryId = 'other'
  let confidence: SectionConfidence = 'low'
  let ambiguous = false
  let alternatives: readonly SectionCategoryId[] = []
  let headingText: string | null = null

  const firstLine = segments[0]?.text ?? ''
  const headingMatch = firstLine ? matchSectionLabel(firstLine) : null
  if (headingMatch && headingMatch.atStart) {
    category = headingMatch.category
    confidence = headingMatch.ambiguous ? 'low' : 'medium'
    ambiguous = headingMatch.ambiguous
    alternatives = headingMatch.alternatives
    headingText = firstLine
  } else if (text) {
    const inferred = inferCategoryFromContent(text)
    if (inferred) {
      category = inferred.category
      ambiguous = inferred.alternatives.length > 0
      alternatives = inferred.alternatives
    }
  }

  const confidences = input.runs
    .map((run) => run.confidence)
    .filter((value): value is number => value !== null)
  const ocrConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null

  return {
    id: input.id,
    pageIndex: input.pageIndex,
    bounds: input.bounds,
    displayTop: display.y,
    displayLeft: display.x,
    category,
    suggestedLabel:
      category === 'other'
        ? `Region ${input.ordinal}`
        : getSectionCategory(category).label,
    origin: 'manual',
    textSource: segments.length > 0 ? input.textSource : 'none',
    confidence,
    ambiguous,
    alternativeCategories: alternatives,
    evidence: 'manual',
    headingText,
    text,
    lineCount: new Set(segments.map((segment) => segment.row)).size,
    ocrConfidence,
  }
}
