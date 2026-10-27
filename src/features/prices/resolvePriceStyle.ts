import type { TextEditFidelityStatus } from '@/lib/pdf/buildTextReplacementPlan'
import { isFontFaceLoaded } from '@/lib/pdf/export/overlayFontResolution'
import { samplePdfRectColors } from '@/lib/pdf/samplePdfRectColors'
import {
  estimateBaselineY,
  inferPriceAlignment,
  type PriceStyleChoice,
} from '@/lib/prices/buildPriceReplacementPlan'
import type { PdfFontInfo } from '@/lib/prices/pdfTextStyles'
import type { PriceCandidate, PriceTextRun } from '@/types/priceEditing'
import { canvasTextMetrics, isSystemFontAvailable } from './canvasTextMetrics'
import { verifyFontTrials, type FontTrial, type FontTrialScore } from './fontVerification'

export type EvidenceLevel = 'exact' | 'measured' | 'approximate' | 'unavailable'

export interface StyleEvidenceRow {
  readonly property: string
  readonly value: string
  readonly detail: string
  readonly level: EvidenceLevel
}

export interface PriceStyleEvidence {
  readonly style: PriceStyleChoice
  readonly fidelityStatus: TextEditFidelityStatus
  readonly fontMatch: 'embedded_verified' | 'approximate'
  readonly fallbackFontFamily: string
  readonly fallbackFontWeight: 'normal' | 'bold'
  readonly rows: readonly StyleEvidenceRow[]
  readonly notes: readonly string[]
  readonly fontScores: readonly FontTrialScore[]
}

const SYSTEM_FAMILIES: Record<PdfFontInfo['genericFamily'], readonly string[]> = {
  'sans-serif': ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'Segoe UI', 'Calibri', 'Roboto', 'Verdana', 'Tahoma', 'Open Sans'],
  serif: ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'Georgia', 'Cambria'],
  monospace: ['Courier New', 'Courier', 'Liberation Mono', 'Consolas'],
}

const DEFAULT_FAMILY: Record<PdfFontInfo['genericFamily'], string> = {
  'sans-serif': 'Arial',
  serif: 'Times New Roman',
  monospace: 'Courier New',
}

/** Re-render similarity at or above which the embedded font is reported as verified. */
const VERIFIED_SIMILARITY = 0.75

function hexDistance(a: string, b: string): number {
  const parse = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  const [r1 = 0, g1 = 0, b1 = 0] = parse(a)
  const [r2 = 0, g2 = 0, b2 = 0] = parse(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function buildTrials(font: PdfFontInfo | null, source: PriceCandidate['source']): FontTrial[] {
  const trials: FontTrial[] = []
  const italic = font?.italic ?? false
  if (font?.embedded && !font.type3 && font.loadedName && isFontFaceLoaded(font.loadedName)) {
    // The embedded face already carries its weight; asking for bold would embolden it twice.
    trials.push({ family: font.loadedName, weight: 'normal', italic: false, label: 'Embedded PDF font', embedded: true })
  }
  const generics: PdfFontInfo['genericFamily'][] =
    source === 'ocr' || !font ? ['sans-serif', 'serif'] : [font.genericFamily]
  const families = new Set<string>()
  if (font && !font.embedded && font.loadedName) {
    families.add(font.loadedName)
  }
  for (const generic of generics) {
    for (const family of SYSTEM_FAMILIES[generic]) {
      families.add(family)
    }
  }
  for (const family of families) {
    if (!isSystemFontAvailable(family)) {
      continue
    }
    for (const weight of ['normal', 'bold'] as const) {
      trials.push({ family, weight, italic, label: family, embedded: false })
    }
  }
  return trials
}

/**
 * Gathers evidence for each visual property of the original value and picks the
 * overlay style. Levels: exact (read from the PDF), measured (verified against the
 * rendered page), approximate (best available substitute) or unavailable.
 */
export function resolvePriceStyle(input: {
  candidate: PriceCandidate
  run: PriceTextRun | null
  pageCandidates: readonly PriceCandidate[]
  font: PdfFontInfo | null
  contentColor: string | null
  pageWidthPt: number
  pageHeightPt: number
  /** Original value text (OCR candidates may be corrected by the user). */
  originalText: string
}): PriceStyleEvidence {
  const { candidate, font } = input
  const rows: StyleEvidenceRow[] = []
  const notes: string[] = []
  const isOcr = candidate.source === 'ocr'
  const size = candidate.fontSizePt
  const baselineY = estimateBaselineY(candidate)
  const generic = font?.genericFamily ?? 'sans-serif'

  const verification = verifyFontTrials({
    pageNumber: candidate.pageIndex + 1,
    pageWidthPt: input.pageWidthPt,
    pageHeightPt: input.pageHeightPt,
    text: input.originalText,
    bounds: candidate.bounds,
    baseline: { x: candidate.bounds.x, y: baselineY },
    fontSizePt: size,
    trials: buildTrials(font, candidate.source),
  })
  const scores = verification.scores
  const embeddedScore = scores.find((score) => score.embedded) ?? null
  const bestSystem = scores.find((score) => !score.embedded) ?? null
  const flaggedWeight: 'normal' | 'bold' = font?.bold ? 'bold' : 'normal'
  const fallbackFontFamily = bestSystem?.family ?? DEFAULT_FAMILY[generic]
  const fallbackFontWeight = bestSystem?.weight ?? flaggedWeight

  const useEmbedded =
    embeddedScore !== null &&
    embeddedScore.similarity >= 0.6 &&
    embeddedScore.similarity >= (bestSystem?.similarity ?? 0) - 0.05
  const chosen = useEmbedded ? embeddedScore : bestSystem
  const fontMatch: PriceStyleEvidence['fontMatch'] =
    useEmbedded && embeddedScore.similarity >= VERIFIED_SIMILARITY && !isOcr ? 'embedded_verified' : 'approximate'

  const fontFamily = useEmbedded ? `${embeddedScore.family}, ${fallbackFontFamily}` : fallbackFontFamily
  const fontWeight: 'normal' | 'bold' = useEmbedded ? 'normal' : fallbackFontWeight

  if (fontMatch === 'embedded_verified') {
    rows.push({
      property: 'Font family',
      value: 'Original embedded font',
      detail: `The PDF's own font program, re-rendered at the original position, matches the page (${percent(embeddedScore!.similarity)} glyph overlap).`,
      level: 'measured',
    })
  } else {
    const why = isOcr
      ? 'Text inside an image has no font information.'
      : font?.type3
        ? 'The PDF uses a Type 3 (drawn) font that cannot be reused.'
        : font?.embedded
          ? embeddedScore
            ? `The embedded font did not re-render reliably (${percent(embeddedScore.similarity)} overlap).`
            : 'The embedded font is not available to the browser.'
          : 'The font is not embedded in the PDF; viewers substitute a system font.'
    rows.push({
      property: 'Font family',
      value: `Approximate font match — ${fallbackFontFamily}`,
      detail: chosen
        ? `${why} Closest available font re-renders with ${percent(chosen.similarity)} glyph overlap.`
        : `${why} ${verification.skippedReason ?? 'No font could be verified.'}`,
      level: 'approximate',
    })
  }
  if (verification.skippedReason) {
    notes.push(verification.skippedReason)
  }

  rows.push({
    property: 'Font size',
    value: `${Math.round(size * 10) / 10} pt`,
    detail: isOcr ? 'Estimated from the height of the recognised digits.' : 'Read from the PDF text matrix.',
    level: isOcr ? 'approximate' : 'exact',
  })

  const weightDetail = useEmbedded
    ? `Carried by the embedded font${font?.bold ? ' (marked bold)' : ''}.`
    : font
      ? `PDF font is marked ${font.bold ? 'bold' : 'regular'}${bestSystem && bestSystem.weight !== flaggedWeight ? `; re-render matched ${bestSystem.weight} better` : ''}.`
      : bestSystem
        ? `Re-render matched ${bestSystem.weight} best.`
        : 'Unknown; regular assumed.'
  rows.push({
    property: 'Font weight',
    value: useEmbedded ? (font?.bold ? 'Bold (embedded)' : 'As embedded') : fontWeight === 'bold' ? 'Bold' : 'Regular',
    detail: weightDetail,
    level: font && !isOcr ? 'exact' : bestSystem ? 'measured' : 'unavailable',
  })

  const sampled = samplePdfRectColors(candidate.pageIndex + 1, input.pageWidthPt, input.pageHeightPt, candidate.bounds)
  let color = input.contentColor ?? sampled.textColor ?? '#000000'
  if (input.contentColor) {
    const mismatch = sampled.textColor ? hexDistance(input.contentColor, sampled.textColor) > 90 : false
    rows.push({
      property: 'Font colour',
      value: input.contentColor,
      detail: mismatch
        ? `Read from the PDF content stream. The rendered pixels look different (${sampled.textColor}); transparency or overprint may apply.`
        : 'Read from the PDF content stream.',
      level: mismatch ? 'measured' : 'exact',
    })
  } else if (sampled.textColor) {
    color = sampled.textColor
    rows.push({
      property: 'Font colour',
      value: sampled.textColor,
      detail: 'Sampled from the darkest glyph pixels on the rendered page.',
      level: 'measured',
    })
  } else {
    rows.push({
      property: 'Font colour',
      value: color,
      detail: 'Could not be read or sampled; black assumed. Check the preview.',
      level: 'unavailable',
    })
  }

  const alignment = inferPriceAlignment(candidate, input.pageCandidates)
  rows.push({
    property: 'Alignment',
    value: alignment.alignment[0]!.toUpperCase() + alignment.alignment.slice(1),
    detail: alignment.evidence,
    level: 'measured',
  })
  rows.push({
    property: 'Baseline',
    value: `y = ${Math.round(baselineY * 10) / 10} pt`,
    detail: candidate.baseline ? 'Read from the PDF text matrix; the replacement sits on the same baseline.' : 'Estimated from the bottom of the recognised digits.',
    level: candidate.baseline ? 'exact' : 'approximate',
  })
  rows.push({
    property: 'Position',
    value: `x = ${Math.round(candidate.bounds.x * 10) / 10} pt`,
    detail:
      candidate.startIndex > 0 || candidate.endIndex < candidate.runText.length
        ? 'The amount is part of a longer text run; its start is measured from font metrics.'
        : isOcr
          ? 'From the OCR bounding box.'
          : 'Read from the PDF text matrix.',
    level: isOcr ? 'approximate' : candidate.startIndex > 0 ? 'measured' : 'exact',
  })

  let letterSpacingPt = 0
  const run = input.run
  if (!isOcr && run?.advanceWidth && chosen && chosen.similarity >= 0.6) {
    const natural = canvasTextMetrics.measureWidth(run.text, fontFamily, fontWeight, size, 0)
    const count = [...run.text].length
    if (natural && count > 0) {
      const perChar = (run.advanceWidth - natural) / count
      if (Math.abs(perChar) >= size * 0.01 && Math.abs(perChar) <= size * 0.3) {
        letterSpacingPt = Math.round(perChar * 100) / 100
      }
    }
  }
  rows.push({
    property: 'Spacing',
    value: letterSpacingPt ? `${letterSpacingPt > 0 ? '+' : ''}${letterSpacingPt} pt per character` : 'Font default',
    detail: letterSpacingPt
      ? 'Adjusted so the overlay font matches the printed advance width of the original text.'
      : isOcr
        ? 'Not measurable from an image.'
        : 'Printed width already matches the overlay font.',
    level: letterSpacingPt ? 'measured' : isOcr ? 'unavailable' : 'measured',
  })

  const maskFillColor = sampled.backgroundColor ?? '#ffffff'
  rows.push({
    property: 'Background',
    value: sampled.backgroundKind === 'solid' ? `Solid ${maskFillColor}` : sampled.backgroundKind === 'complex' ? 'Patterned or uneven' : 'Unknown',
    detail:
      sampled.backgroundKind === 'complex'
        ? 'A flat cover cannot reconstruct this background; it may show as a patch.'
        : sampled.backgroundKind === 'solid'
          ? 'Sampled around the value on the rendered page.'
          : 'Could not sample; white assumed.',
    level: sampled.backgroundKind === 'solid' ? 'measured' : sampled.backgroundKind === 'complex' ? 'approximate' : 'unavailable',
  })

  let fidelityStatus: TextEditFidelityStatus
  if (isOcr) {
    fidelityStatus = 'ocr_assisted'
  } else if (sampled.backgroundKind === 'complex') {
    fidelityStatus = 'background_reconstruction_required'
  } else if (fontMatch === 'embedded_verified' && input.contentColor && sampled.backgroundKind === 'solid') {
    fidelityStatus = 'original_style_matched'
  } else if (fontMatch === 'approximate') {
    fidelityStatus = 'approximate_font_match'
  } else {
    fidelityStatus = 'visual_verification_recommended'
  }
  notes.push('The original value stays in the PDF under an opaque cover; the replacement is drawn on top.')

  return {
    style: {
      fontFamily,
      fontWeight,
      fontSizePt: size,
      color,
      maskFillColor,
      maskOpacity: 1,
      letterSpacingPt,
      alignment: alignment.alignment,
      backgroundKind: sampled.backgroundKind,
    },
    fidelityStatus,
    fontMatch,
    fallbackFontFamily,
    fallbackFontWeight,
    rows,
    notes,
    fontScores: scores,
  }
}
