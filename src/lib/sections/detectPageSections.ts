import {
  inferCategoryFromContent,
  looksLikeValue,
  matchSectionLabel,
  normalizeLabelText,
  toTitleCase,
  type LabelMatch,
} from '@/lib/sections/classifySectionText'
import {
  groupRunsIntoSegments,
  groupSegmentsIntoBlocks,
  median,
  rectBottom,
  rectRight,
  segmentsToText,
  unionRects,
  type LayoutRun,
  type LayoutSegment,
} from '@/lib/sections/layoutTextLines'
import { getSectionCategory } from '@/lib/sections/sectionCategories'
import { stableSectionId } from '@/lib/sections/sectionIds'
import type { PageRect } from '@/types'
import type {
  DocumentSection,
  SectionCategoryId,
  SectionConfidence,
  SectionEvidence,
  SectionTextRun,
} from '@/types/documentSections'

export interface PageSectionDetectionInput {
  readonly pageIndex: number
  readonly runs: readonly SectionTextRun[]
  readonly textSource: 'pdf_text' | 'ocr'
  /** PDF user space → reading frame at scale 1 (top-left origin, text reads left-to-right). */
  readonly toDisplayRect: (pdfRect: PageRect) => PageRect
  readonly toPdfRect: (displayRect: PageRect) => PageRect
  readonly displayWidth: number
  readonly displayHeight: number
}

/**
 * heading — a section title ("PASSENGER DETAILS", "Flight Information:")
 * label   — an inline key/value line in a block-level category ("PNR: AB12CD")
 * field   — a fare/tax/total line that becomes its own small section
 * body    — anything else
 */
type SegmentRole = 'heading' | 'label' | 'field' | 'body'

interface SegmentInfo {
  readonly role: SegmentRole
  readonly match: LabelMatch | null
  readonly styled: boolean
}

interface Chunk {
  readonly lead: LayoutSegment | null
  readonly leadRole: 'heading' | 'label' | null
  readonly category: SectionCategoryId | null
  segments: LayoutSegment[]
  consumed: boolean
}

const SECTION_PADDING = 2
const OCR_LOW_CONFIDENCE = 60

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function letterCount(text: string): number {
  return text.replace(/[^\p{L}]/gu, '').length
}

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '')
  return (
    letters.length >= 3 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  )
}

/**
 * Size ratio over the page median for a line to count as a heading by size alone.
 * OCR boxes include descenders ("Economy" vs "DAC 10:30"), so OCR needs a wider margin.
 */
const SIZE_HEADING_RATIO = { pdf_text: 1.2, ocr: 1.5 } as const

function classifySegment(
  segment: LayoutSegment,
  medianFontSize: number,
  sizeHeadingRatio: number,
): SegmentInfo {
  const text = segment.text
  const words = wordCount(text)
  const endsWithColon = /:\s*$/.test(text)
  const larger =
    medianFontSize > 0 && segment.fontSize >= medianFontSize * (sizeHeadingRatio - 0.05)
  const styled = isAllCaps(text) || endsWithColon || larger
  const match = matchSectionLabel(text)

  if (match) {
    const scope = getSectionCategory(match.category).scope
    if (scope === 'field') {
      if (match.atStart && words <= 8) {
        return { role: 'field', match, styled }
      }
    } else {
      const remainder = normalizeLabelText(text)
        .slice(match.atStart ? match.matchedText.length : 0)
        .trim()
      if (match.coverage >= 0.6 || (match.atStart && words <= 4 && !remainder)) {
        return { role: 'heading', match, styled }
      }
      if (match.atStart && words <= 10) {
        return { role: 'label', match, styled }
      }
    }
  }

  const letters = letterCount(text)
  const compactLength = Math.max(text.replace(/\s/g, '').length, 1)
  const digitRatio = text.replace(/\D/g, '').length / compactLength
  if (letters >= 3 && digitRatio < 0.3) {
    if (medianFontSize > 0 && segment.fontSize >= medianFontSize * sizeHeadingRatio && words <= 8) {
      return { role: 'heading', match: null, styled: true }
    }
    if (endsWithColon && words <= 4) {
      return { role: 'heading', match: null, styled: true }
    }
  }
  return { role: 'body', match: null, styled }
}

function meanConfidence(segments: readonly LayoutSegment[]): number | null {
  const values = segments.flatMap((segment) =>
    segment.runs
      .map((run) => run.confidence)
      .filter((value): value is number => value !== null),
  )
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function capForOcr(
  confidence: SectionConfidence,
  textSource: 'pdf_text' | 'ocr',
  ocrConfidence: number | null,
): SectionConfidence {
  if (textSource !== 'ocr') {
    return confidence
  }
  if (ocrConfidence !== null && ocrConfidence < OCR_LOW_CONFIDENCE) {
    return 'low'
  }
  return confidence === 'high' ? 'medium' : confidence
}

function chunkRect(chunk: Chunk): PageRect | null {
  const parts = chunk.lead ? [chunk.lead, ...chunk.segments] : chunk.segments
  return parts.length > 0 ? unionRects(parts.map((segment) => segment.rect)) : null
}

/**
 * Suggests sections for one page from positioned text. Only text that is actually
 * present produces a section; categories are heuristics, never guaranteed.
 */
export function detectPageSections(input: PageSectionDetectionInput): DocumentSection[] {
  const layoutRuns: LayoutRun[] = input.runs.map((run) => {
    const rect = input.toDisplayRect(run.bounds)
    return {
      text: run.text,
      rect,
      fontSize:
        run.fontSizePt && run.fontSizePt > 0
          ? Math.min(run.fontSizePt, rect.height)
          : rect.height * 0.85,
      confidence: run.confidence,
    }
  })

  const segments = groupRunsIntoSegments(layoutRuns)
  if (segments.length === 0) {
    return []
  }
  const medianFontSize = median(segments.map((segment) => segment.fontSize))
  const info = new Map<number, SegmentInfo>()
  for (const segment of segments) {
    info.set(
      segment.id,
      classifySegment(segment, medianFontSize, SIZE_HEADING_RATIO[input.textSource]),
    )
  }
  const roleOf = (segment: LayoutSegment): SegmentRole =>
    info.get(segment.id)?.role ?? 'body'

  const consumedSegmentIds = new Set<number>()
  const drafts: DocumentSection[] = []

  const pushSection = (draft: {
    segments: readonly LayoutSegment[]
    category: SectionCategoryId
    suggestedLabel: string
    confidence: SectionConfidence
    ambiguous: boolean
    alternatives: readonly SectionCategoryId[]
    evidence: SectionEvidence
    headingText: string | null
  }) => {
    const displayRect = padAndClamp(
      unionRects(draft.segments.map((segment) => segment.rect)),
      input.displayWidth,
      input.displayHeight,
    )
    const bounds = input.toPdfRect(displayRect)
    const ocrConfidence =
      input.textSource === 'ocr' ? meanConfidence(draft.segments) : null
    const lowOcr = ocrConfidence !== null && ocrConfidence < OCR_LOW_CONFIDENCE
    drafts.push({
      id: stableSectionId({
        pageIndex: input.pageIndex,
        textSource: input.textSource,
        category: draft.category,
        evidence: draft.evidence,
        bounds,
      }),
      pageIndex: input.pageIndex,
      bounds,
      displayTop: displayRect.y,
      displayLeft: displayRect.x,
      category: draft.category,
      suggestedLabel: draft.suggestedLabel,
      origin: 'auto',
      textSource: input.textSource,
      confidence: capForOcr(draft.confidence, input.textSource, ocrConfidence),
      ambiguous: draft.ambiguous || lowOcr,
      alternativeCategories: draft.alternatives,
      evidence: draft.evidence,
      headingText: draft.headingText,
      text: segmentsToText(draft.segments),
      lineCount: new Set(draft.segments.map((segment) => segment.row)).size,
      ocrConfidence,
    })
  }

  // 1. Fare/tax/total lines: the label plus value cells to its right on the same row.
  for (const segment of segments) {
    const segmentInfo = info.get(segment.id)
    if (segmentInfo?.role !== 'field' || !segmentInfo.match) {
      continue
    }
    const sameRow = segments
      .filter((other) => other.row === segment.row && other.rect.x > segment.rect.x)
      .sort((a, b) => a.rect.x - b.rect.x)
    const values: LayoutSegment[] = []
    for (const other of sameRow) {
      if (roleOf(other) !== 'body' || !looksLikeValue(other.text)) {
        break
      }
      values.push(other)
    }
    const fieldSegments = [segment, ...values]
    const hasAmount = fieldSegments.some((part) => /\d/.test(part.text))
    const match = segmentInfo.match
    for (const part of fieldSegments) {
      consumedSegmentIds.add(part.id)
    }
    pushSection({
      segments: fieldSegments,
      category: match.category,
      suggestedLabel: getSectionCategory(match.category).label,
      confidence: hasAmount && !match.ambiguous ? 'high' : 'medium',
      ambiguous: match.ambiguous,
      alternatives: match.alternatives,
      evidence: 'field_label',
      headingText: match.matchedText,
    })
  }

  // 2. Split spatial blocks into chunks at headings; inline labels only split headless/other-category chunks.
  const chunks: Chunk[] = []
  for (const block of groupSegmentsIntoBlocks(segments)) {
    let current: Chunk | null = null
    for (const segment of block.segments) {
      const segmentInfo = info.get(segment.id)
      const role = segmentInfo?.role ?? 'body'
      const category = segmentInfo?.match?.category ?? null
      const startsChunk =
        role === 'heading' ||
        (role === 'label' &&
          (!current ||
            (current.leadRole !== 'heading' && current.category !== category)))
      if (startsChunk) {
        current = {
          lead: segment,
          leadRole: role === 'heading' ? 'heading' : 'label',
          category,
          segments: [],
          consumed: false,
        }
        chunks.push(current)
        continue
      }
      if (!current) {
        current = { lead: null, leadRole: null, category: null, segments: [], consumed: false }
        chunks.push(current)
      }
      current.segments.push(segment)
    }
  }

  // 3. A titled chunk absorbs a same-row value (label: value layouts) or the untitled blocks beneath it in its column.
  for (const chunk of chunks) {
    const lead = chunk.lead
    if (!lead || chunk.consumed) {
      continue
    }
    const fontSize = Math.max(lead.fontSize, medianFontSize)

    const nextOnRow = segments
      .filter((other) => other.row === lead.row && other.rect.x > lead.rect.x)
      .sort((a, b) => a.rect.x - b.rect.x)[0]
    let columnRight = input.displayWidth
    if (nextOnRow) {
      const gap = nextOnRow.rect.x - rectRight(lead.rect)
      const labelLike = /:\s*$/.test(lead.text) || wordCount(lead.text) <= 3
      if (
        roleOf(nextOnRow) === 'body' &&
        !consumedSegmentIds.has(nextOnRow.id) &&
        chunk.segments.length === 0 &&
        labelLike &&
        gap <= input.displayWidth * 0.3
      ) {
        chunk.segments.push(nextOnRow)
        consumedSegmentIds.add(nextOnRow.id)
        for (const other of chunks) {
          if (other !== chunk) {
            other.segments = other.segments.filter((segment) => segment.id !== nextOnRow.id)
          }
        }
        continue
      }
      columnRight = nextOnRow.rect.x
    }

    const columnLeft = lead.rect.x - fontSize * 2
    const ownRect = chunkRect(chunk) ?? lead.rect
    let currentBottom = rectBottom(ownRect)
    const reach = (chunk.segments.length === 0 ? 3 : 1.8) * fontSize * 1.2

    const candidates = chunks
      .filter((other) => other !== chunk && !other.consumed)
      .map((other) => ({ chunk: other, rect: chunkRect(other) }))
      .filter(
        (entry): entry is { chunk: Chunk; rect: PageRect } =>
          entry.rect !== null &&
          entry.rect.y >= currentBottom - 1 &&
          entry.rect.x >= columnLeft &&
          entry.rect.x < columnRight,
      )
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)

    for (const candidate of candidates) {
      if (candidate.rect.y - currentBottom > reach) {
        break
      }
      const other = candidate.chunk
      if (other.leadRole === 'heading') {
        break
      }
      if (
        other.leadRole === 'label' &&
        !(chunk.leadRole === 'heading' && (chunk.category === null || chunk.category === other.category))
      ) {
        break
      }
      other.consumed = true
      chunk.segments.push(...(other.lead ? [other.lead] : []), ...other.segments)
      currentBottom = Math.max(currentBottom, rectBottom(candidate.rect))
    }
  }

  // 4. Emit chunk sections.
  for (const chunk of chunks) {
    if (chunk.consumed) {
      continue
    }
    if (chunk.lead) {
      const leadInfo = info.get(chunk.lead.id)
      const all = [chunk.lead, ...chunk.segments]
      const match = leadInfo?.match ?? null
      if (match) {
        const strong =
          chunk.leadRole === 'heading' &&
          match.coverage >= 0.6 &&
          (leadInfo?.styled || match.coverage >= 0.9)
        pushSection({
          segments: all,
          category: match.category,
          suggestedLabel: getSectionCategory(match.category).label,
          confidence: strong && !match.ambiguous ? 'high' : 'medium',
          ambiguous: match.ambiguous,
          alternatives: match.alternatives,
          evidence: chunk.leadRole === 'heading' ? 'heading' : 'field_label',
          headingText: chunk.lead.text,
        })
        continue
      }
      const inferred = inferCategoryFromContent(segmentsToText(all))
      pushSection({
        segments: all,
        category: inferred?.category ?? 'other',
        suggestedLabel: toTitleCase(chunk.lead.text),
        confidence: 'low',
        ambiguous: Boolean(inferred && inferred.alternatives.length > 0),
        alternatives: inferred?.alternatives ?? [],
        evidence: inferred ? 'content' : 'layout',
        headingText: chunk.lead.text,
      })
      continue
    }

    const remaining = chunk.segments.filter((segment) => !consumedSegmentIds.has(segment.id))
    const text = segmentsToText(remaining)
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 4) {
      continue
    }
    if (remaining.length === 1 && looksLikeValue(text) && letterCount(text) < 4) {
      continue
    }
    const inferred = inferCategoryFromContent(text)
    pushSection({
      segments: remaining,
      category: inferred?.category ?? 'other',
      suggestedLabel: inferred
        ? getSectionCategory(inferred.category).label
        : `Text block: ${truncate(remaining[0]?.text ?? '', 28)}`,
      confidence: 'low',
      ambiguous: Boolean(inferred && inferred.alternatives.length > 0),
      alternatives: inferred?.alternatives ?? [],
      evidence: inferred ? 'content' : 'layout',
      headingText: null,
    })
  }

  const seen = new Set<string>()
  return drafts
    .filter((draft) => {
      if (seen.has(draft.id)) {
        return false
      }
      seen.add(draft.id)
      return true
    })
    .sort(compareSectionsInReadingOrder)
}

export function compareSectionsInReadingOrder(
  a: Pick<DocumentSection, 'pageIndex' | 'displayTop' | 'displayLeft'>,
  b: Pick<DocumentSection, 'pageIndex' | 'displayTop' | 'displayLeft'>,
): number {
  return (
    a.pageIndex - b.pageIndex ||
    Math.round(a.displayTop) - Math.round(b.displayTop) ||
    a.displayLeft - b.displayLeft
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function padAndClamp(rect: PageRect, width: number, height: number): PageRect {
  const x = Math.max(0, rect.x - SECTION_PADDING)
  const y = Math.max(0, rect.y - SECTION_PADDING)
  const right = Math.min(width, rect.x + rect.width + SECTION_PADDING)
  const bottom = Math.min(height, rect.y + rect.height + SECTION_PADDING)
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}
