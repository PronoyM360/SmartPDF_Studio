import type { TextEditFidelityStatus, TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import type { BackgroundKind } from '@/lib/pdf/samplePdfRectColors'
import type { PageRect } from '@/types'
import type { PriceAlignment, PriceCandidate } from '@/types/priceEditing'

export interface PriceStyleChoice {
  /** CSS font-family list used for preview, editor overlay and rasterized export. */
  readonly fontFamily: string
  readonly fontWeight: 'normal' | 'bold'
  readonly fontSizePt: number
  readonly color: string
  readonly maskFillColor: string
  readonly maskOpacity: number
  readonly letterSpacingPt: number
  readonly alignment: PriceAlignment
  readonly backgroundKind: BackgroundKind
}

export interface PriceTextMetrics {
  /** Advance width in PDF points, including letter spacing. */
  readonly measureWidth: (
    text: string,
    fontFamily: string,
    fontWeight: 'normal' | 'bold',
    fontSizePt: number,
    letterSpacingPt: number,
  ) => number | null
  /** Distance from the text box top to the baseline, as the editor overlay lays it out. */
  readonly baselineFromTop: (
    fontFamily: string,
    fontWeight: 'normal' | 'bold',
    fontSizePt: number,
  ) => number | null
}

export interface PriceNeighborText {
  readonly text: string
  readonly bounds: PageRect
}

export interface PricePlanResult {
  readonly plan: TextReplacementPlan
  readonly warnings: readonly string[]
  readonly originalWidth: number
  readonly replacementWidth: number
}

/** Fallback when canvas metrics are unavailable: typical sans-serif ascent/descent. */
const FALLBACK_BASELINE_FROM_TOP = 0.85
const BOX_HEIGHT_RATIO = 1.2
/** Share of a PDF.js text box below the baseline (see `computeTextItemGeometry`). */
const PDF_BOX_DESCENT_SHARE = 0.25

export function estimateBaselineY(candidate: PriceCandidate): number {
  if (candidate.baseline) {
    return candidate.baseline.y
  }
  // OCR boxes hug the glyphs; digits sit on the baseline.
  return candidate.source === 'ocr'
    ? candidate.bounds.y
    : candidate.bounds.y + candidate.bounds.height * PDF_BOX_DESCENT_SHARE
}

function union(a: PageRect, b: PageRect): PageRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

function overlapArea(a: PageRect, b: PageRect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Infers alignment from neighbouring amounts: values in a right-aligned column
 * share right edges, so a longer replacement must grow to the left.
 */
export function inferPriceAlignment(
  candidate: PriceCandidate,
  pageCandidates: readonly PriceCandidate[],
): { alignment: PriceAlignment; evidence: string } {
  const tolerance = Math.max(1.2, candidate.fontSizePt * 0.12)
  const right = candidate.bounds.x + candidate.bounds.width
  const center = candidate.bounds.x + candidate.bounds.width / 2
  let rightCount = 0
  let leftCount = 0
  let centerCount = 0
  for (const other of pageCandidates) {
    if (other.id === candidate.id || other.source !== candidate.source) {
      continue
    }
    if (Math.abs(other.bounds.y - candidate.bounds.y) > candidate.fontSizePt * 25) {
      continue
    }
    const otherRight = other.bounds.x + other.bounds.width
    const sameWidth = Math.abs(other.bounds.width - candidate.bounds.width) <= tolerance
    if (Math.abs(otherRight - right) <= tolerance) {
      rightCount += 1
    }
    if (Math.abs(other.bounds.x - candidate.bounds.x) <= tolerance) {
      leftCount += 1
    }
    if (!sameWidth && Math.abs(other.bounds.x + other.bounds.width / 2 - center) <= tolerance) {
      centerCount += 1
    }
  }
  const sameWidthOnly = rightCount > 0 && rightCount === leftCount
  if (rightCount > leftCount || (sameWidthOnly && candidate.labelPlacement !== 'inline')) {
    return {
      alignment: 'right',
      evidence: `Right edge lines up with ${rightCount} other amount${rightCount === 1 ? '' : 's'}; the right edge stays fixed.`,
    }
  }
  if (centerCount > leftCount && centerCount > rightCount) {
    return {
      alignment: 'center',
      evidence: `Centre lines up with ${centerCount} other amount${centerCount === 1 ? '' : 's'}; the value stays centred.`,
    }
  }
  return {
    alignment: 'left',
    evidence:
      leftCount > 0
        ? `Left edge lines up with ${leftCount} other amount${leftCount === 1 ? '' : 's'}; the left edge stays fixed.`
        : 'No aligned column found; the left edge stays fixed.',
  }
}

/** Mask and text geometry that keeps the original baseline, size and anchored edge. */
export function buildPriceReplacementPlan(input: {
  candidate: PriceCandidate
  replacementText: string
  style: PriceStyleChoice
  fidelityStatus: TextEditFidelityStatus
  fidelityNotes: readonly string[]
  neighbors: readonly PriceNeighborText[]
  metrics?: PriceTextMetrics
}): PricePlanResult {
  const { candidate, style, metrics } = input
  const replacement = input.replacementText.trim()
  const size = style.fontSizePt
  const original = candidate.bounds
  const warnings: string[] = []

  const measured = metrics?.measureWidth(
    replacement || ' ',
    style.fontFamily,
    style.fontWeight,
    size,
    style.letterSpacingPt,
  )
  const proportional =
    original.width * (Math.max(replacement.length, 1) / Math.max(candidate.text.length, 1))
  const width = measured && measured > 0 ? measured : proportional
  const slack = Math.max(1, size * 0.15)
  const boxWidth = width + slack

  let boxX: number
  if (style.alignment === 'right') {
    boxX = original.x + original.width - boxWidth
  } else if (style.alignment === 'center') {
    boxX = original.x + original.width / 2 - boxWidth / 2
  } else {
    boxX = original.x
  }

  const baselineY = estimateBaselineY(candidate)
  const baselineFromTop =
    metrics?.baselineFromTop(style.fontFamily, style.fontWeight, size) ?? size * FALLBACK_BASELINE_FROM_TOP
  const boxHeight = Math.max(size * BOX_HEIGHT_RATIO, baselineFromTop + size * 0.3)
  const top = baselineY + baselineFromTop
  const textBounds: PageRect = { x: boxX, y: top - boxHeight, width: boxWidth, height: boxHeight }

  const pad = Math.max(0.6, size * 0.06)
  const originalCover: PageRect = {
    x: original.x - pad,
    y: original.y - pad / 2,
    width: original.width + pad * 2,
    height: original.height + pad,
  }
  const maskBounds = union(originalCover, textBounds)

  for (const neighbor of input.neighbors) {
    const overlap = overlapArea(maskBounds, neighbor.bounds)
    if (overlap.width > Math.max(0.8, size * 0.05) && overlap.height > neighbor.bounds.height * 0.3) {
      const snippet = neighbor.text.trim().slice(0, 24)
      warnings.push(
        `The cover would overlap nearby text “${snippet}”. Try a smaller size or a shorter value.`,
      )
    }
  }
  if (width > original.width * 1.35) {
    warnings.push(
      `The replacement is ${Math.round((width / original.width - 1) * 100)}% wider than the original value.`,
    )
  }

  const plan: TextReplacementPlan = {
    maskBounds,
    textBounds,
    fontFamily: style.fontFamily,
    fontSize: size,
    fontWeight: style.fontWeight,
    color: style.color,
    alignment: style.alignment,
    maskFillColor: style.maskFillColor,
    maskOpacity: style.maskOpacity,
    fidelityStatus: input.fidelityStatus,
    fidelityNotes: input.fidelityNotes,
    letterSpacing: style.letterSpacingPt,
  }
  return { plan, warnings, originalWidth: original.width, replacementWidth: width }
}
