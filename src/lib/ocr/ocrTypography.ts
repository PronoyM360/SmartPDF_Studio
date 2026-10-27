import type { TextAlignment } from '@/types/textOverlay'
import type { PageRect } from '@/types'

/** Typical sans-serif proportions, in em. */
const CAP_HEIGHT_EM = 0.72
const X_HEIGHT_EM = 0.52
const DESCENDER_EM = 0.21
const BOLD_STROKE_EM = 0.125
const MIN_FONT_PX_FOR_WEIGHT = 20

interface PixelBox {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface GlyphMetrics {
  readonly fontSizePx: number
  /** Distance from the top of the glyph box to the baseline, in pixels. */
  readonly baselineFromTopPx: number
  /** False when the text has no letters or digits to measure against. */
  readonly reliable: boolean
}

function topRatio(text: string): number {
  if (/[A-Z0-9bdfhiklt$€£¥#%&@!?/\\(){}[\]|'"]/.test(text)) {
    return CAP_HEIGHT_EM
  }
  return /[a-z]/.test(text) ? X_HEIGHT_EM : CAP_HEIGHT_EM
}

function hasDescender(text: string): boolean {
  return /[gjpqy,;(){}[\]|]/.test(text)
}

/**
 * Font size and baseline from an OCR word box. OCR boxes hug the ink, so the box
 * height depends on which letters are present (x-height vs caps vs descenders).
 */
export function estimateGlyphMetrics(input: {
  text: string
  bbox: PixelBox
  lineBaseline?: PixelBox | null
}): GlyphMetrics {
  const { text, bbox } = input
  const height = Math.max(1, bbox.y1 - bbox.y0)
  const top = topRatio(text)
  const descends = hasDescender(text)
  const reliable = /[\p{L}\p{N}]/u.test(text)

  const line = input.lineBaseline
  if (line && line.x1 !== line.x0) {
    const centre = (bbox.x0 + bbox.x1) / 2
    const t = (centre - line.x0) / (line.x1 - line.x0)
    const baseline = line.y0 + (line.y1 - line.y0) * t
    const above = baseline - bbox.y0
    if (above > height * 0.3 && baseline <= bbox.y1 + height * 0.35) {
      return { fontSizePx: above / top, baselineFromTopPx: above, reliable }
    }
  }
  const fontSizePx = height / (top + (descends ? DESCENDER_EM : 0))
  return { fontSizePx, baselineFromTopPx: fontSizePx * top, reliable }
}

/** Words on one line share a font size; outliers (punctuation, misreads) take the median. */
export function harmonizeLineFontSizes(metrics: readonly GlyphMetrics[]): GlyphMetrics[] {
  const sizes = metrics
    .filter((entry) => entry.reliable)
    .map((entry) => entry.fontSizePx)
    .sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)]
  if (!median) {
    return [...metrics]
  }
  return metrics.map((entry) => {
    if (entry.reliable && Math.abs(entry.fontSizePx - median) <= median * 0.35) {
      return entry
    }
    const ratio = median / entry.fontSizePx
    return {
      fontSizePx: median,
      baselineFromTopPx: entry.baselineFromTopPx * ratio,
      reliable: entry.reliable,
    }
  })
}

export function estimateFontWeight(
  strokeWidthPx: number | null,
  fontSizePx: number,
): { weight: 'normal' | 'bold'; note: string } {
  if (!strokeWidthPx || fontSizePx < MIN_FONT_PX_FOR_WEIGHT) {
    return { weight: 'normal', note: 'Text is too small at this resolution to judge its weight.' }
  }
  const ratio = strokeWidthPx / fontSizePx
  return ratio >= BOLD_STROKE_EM
    ? { weight: 'bold', note: `Strokes look heavy (${(ratio * 100).toFixed(0)}% of the font size) — bold suggested.` }
    : { weight: 'normal', note: `Strokes look regular (${(ratio * 100).toFixed(0)}% of the font size).` }
}

export interface FontWidthMatch {
  readonly family: string
  /** Measured width of the original text in this font ÷ the scanned glyph box width. */
  readonly widthRatio: number
}

/**
 * Ranks candidate fonts by how closely the original text, set in each, matches the
 * width of the scanned glyphs. A width match is a proxy — it does not compare shapes.
 */
export function rankFontsByWidth(input: {
  text: string
  boxWidth: number
  fontSize: number
  fontWeight: 'normal' | 'bold'
  families: readonly string[]
  measure: (text: string, family: string, weight: 'normal' | 'bold', size: number) => number | null
}): FontWidthMatch[] {
  const text = input.text.trim()
  if (!text || input.boxWidth <= 0) {
    return []
  }
  const matches: FontWidthMatch[] = []
  for (const family of input.families) {
    const width = input.measure(text, family, input.fontWeight, input.fontSize)
    if (width && width > 0) {
      matches.push({ family, widthRatio: width / input.boxWidth })
    }
  }
  return matches.sort((a, b) => Math.abs(Math.log(a.widthRatio)) - Math.abs(Math.log(b.widthRatio)))
}

export interface NeighborText {
  readonly text: string
  /** Display-space box in points (top-left origin, as shown on screen). */
  readonly box: PageRect
}

/**
 * Values in a column share an edge: a right-aligned total must grow to the left, a
 * centred heading must stay centred.
 */
export function inferOcrAlignment(
  target: PageRect,
  neighbors: readonly NeighborText[],
  fontSize: number,
): { alignment: TextAlignment; evidence: string } {
  const tolerance = Math.max(1.2, fontSize * 0.15)
  const right = target.x + target.width
  const centre = target.x + target.width / 2
  let leftCount = 0
  let rightCount = 0
  let centreCount = 0
  for (const neighbor of neighbors) {
    const box = neighbor.box
    const sameLine = Math.abs(box.y - target.y) < fontSize * 0.5
    if (sameLine || Math.abs(box.y - target.y) > fontSize * 25) {
      continue
    }
    if (Math.abs(box.x - target.x) <= tolerance) {
      leftCount += 1
    }
    if (Math.abs(box.x + box.width - right) <= tolerance) {
      rightCount += 1
    }
    const sameWidth = Math.abs(box.width - target.width) <= tolerance
    if (!sameWidth && Math.abs(box.x + box.width / 2 - centre) <= tolerance) {
      centreCount += 1
    }
  }
  if (rightCount > leftCount && rightCount > 0) {
    return {
      alignment: 'right',
      evidence: `Right edge lines up with ${rightCount} other value${rightCount === 1 ? '' : 's'} — the right edge stays fixed.`,
    }
  }
  if (centreCount >= 2 && centreCount > leftCount && centreCount > rightCount) {
    return {
      alignment: 'center',
      evidence: `Centre lines up with ${centreCount} other lines — the text stays centred.`,
    }
  }
  return {
    alignment: 'left',
    evidence:
      leftCount > 0
        ? `Left edge lines up with ${leftCount} other value${leftCount === 1 ? '' : 's'} — the left edge stays fixed.`
        : 'No aligned column found — the left edge stays fixed.',
  }
}

export type OverflowPolicy = 'extend' | 'fit'

export interface OcrTextLayout {
  /** Display-space text box (points, top-left origin). */
  readonly textBox: PageRect
  readonly fontSize: number
  /** Original glyph box ∪ new text box, padded — what a flat cover would need. */
  readonly coverBox: PageRect
  readonly growthRatio: number
  /** Font scale applied by the "fit" policy (1 when unchanged). */
  readonly fitScale: number
  readonly overlaps: readonly string[]
  readonly offPage: boolean
  readonly warnings: readonly string[]
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

function overlap(a: PageRect, b: PageRect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  }
}

/**
 * Places replacement text so its baseline and anchored edge match the original.
 * Longer text either grows (with overlap warnings) or, only when the user picks
 * "fit", is scaled down uniformly — it is never squeezed horizontally.
 */
export function layoutOcrReplacement(input: {
  original: PageRect
  baselineFromTop: number
  fontSize: number
  /** Measured advance of the replacement at `fontSize`, in points. */
  replacementWidth: number
  /** Distance from the text box top to the first baseline at `fontSize` (editor layout). */
  ascentFromTop: number
  alignment: TextAlignment
  neighbors: readonly NeighborText[]
  page: { width: number; height: number }
  overflow: OverflowPolicy
}): OcrTextLayout {
  const { original, alignment } = input
  const warnings: string[] = []
  const growthRatio = input.replacementWidth / Math.max(1, original.width)

  let fitScale = 1
  if (input.overflow === 'fit' && input.replacementWidth > original.width) {
    fitScale = original.width / input.replacementWidth
    warnings.push(
      `Font size reduced to ${Math.round(fitScale * 100)}% so the text fits the original width.${fitScale < 0.75 ? ' It will look noticeably smaller than nearby text.' : ''}`,
    )
  }
  const fontSize = input.fontSize * fitScale
  const width = input.replacementWidth * fitScale
  const ascent = input.ascentFromTop * fitScale
  const slack = Math.max(0.5, fontSize * 0.12)
  const boxWidth = width + slack

  let x = original.x
  if (alignment === 'right') {
    x = original.x + original.width - boxWidth
  } else if (alignment === 'center') {
    x = original.x + original.width / 2 - boxWidth / 2
  }
  const baseline = original.y + input.baselineFromTop
  const height = Math.max(fontSize * 1.25, ascent + fontSize * 0.3)
  const textBox: PageRect = { x, y: baseline - ascent, width: boxWidth, height }

  if (input.overflow === 'extend' && growthRatio > 1.05) {
    warnings.push(
      `The replacement is ${Math.round((growthRatio - 1) * 100)}% wider than the original and extends ${alignment === 'right' ? 'to the left' : alignment === 'center' ? 'on both sides' : 'to the right'}.`,
    )
  }

  const overlaps: string[] = []
  for (const neighbor of input.neighbors) {
    const area = neighbor.box.width * neighbor.box.height
    const withOriginal = overlap(neighbor.box, original)
    if (withOriginal.width > 0 && withOriginal.height > 0 && withOriginal.width * withOriginal.height > area * 0.5) {
      continue
    }
    const hit = overlap(textBox, neighbor.box)
    if (hit.width > Math.max(0.5, fontSize * 0.05) && hit.height > neighbor.box.height * 0.3) {
      overlaps.push(neighbor.text.trim().slice(0, 24))
    }
  }
  if (overlaps.length > 0) {
    warnings.push(
      `The new text would overlap nearby text: ${overlaps.map((text) => `“${text}”`).join(', ')}.`,
    )
  }

  const offPage =
    textBox.x < 0 ||
    textBox.y < 0 ||
    textBox.x + textBox.width > input.page.width ||
    textBox.y + textBox.height > input.page.height
  if (offPage) {
    warnings.push('The new text runs past the page edge.')
  }

  const pad = Math.max(0.6, input.fontSize * 0.08)
  const coverBox = union(
    { x: original.x - pad, y: original.y - pad, width: original.width + pad * 2, height: original.height + pad * 2 },
    textBox,
  )

  return { textBox, fontSize, coverBox, growthRatio, fitScale, overlaps, offPage, warnings }
}
