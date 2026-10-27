export interface BinaryMask {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

export interface InkBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function inkBounds(mask: BinaryMask, region?: InkBox): InkBox | null {
  const x0 = region?.x ?? 0
  const y0 = region?.y ?? 0
  const x1 = region ? region.x + region.width : mask.width
  const y1 = region ? region.y + region.height : mask.height
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (mask.data[y * mask.width + x]) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Overlap of two glyph masks aligned at the top-left of their ink, as intersection over
 * union (0–1). Neither mask is stretched, so a wider font scores lower.
 */
export function maskSimilarity(a: BinaryMask, aBox: InkBox, b: BinaryMask, bBox: InkBox): number {
  const width = Math.max(aBox.width, bBox.width)
  const height = Math.max(aBox.height, bBox.height)
  let intersection = 0
  let union = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inA =
        x < aBox.width && y < aBox.height && a.data[(aBox.y + y) * a.width + aBox.x + x] ? 1 : 0
      const inB =
        x < bBox.width && y < bBox.height && b.data[(bBox.y + y) * b.width + bBox.x + x] ? 1 : 0
      intersection += inA & inB
      union += inA | inB
    }
  }
  return union > 0 ? intersection / union : 0
}

export interface FontShapeCandidate {
  readonly family: string
  readonly weight: 'normal' | 'bold'
}

export interface FontShapeMatch extends FontShapeCandidate {
  /** Glyph-mask overlap with the scan once scaled to the same ink height (0–1). */
  readonly similarity: number
  /** Rendered ink width ÷ scanned ink width at that height. */
  readonly widthRatio: number
  /** Font size (pt) at which this font's ink height equals the scan's. */
  readonly impliedSizePt: number
}

/** Renders text into a binary mask; returns null where canvas is unavailable. */
export type GlyphRasterizer = (
  text: string,
  family: string,
  weight: 'normal' | 'bold',
  sizePx: number,
) => BinaryMask | null

const PROBE_SIZE_PX = 96

/**
 * Compares the scanned glyphs with each candidate font, rendered at the size that
 * matches the scan's ink height. Best overall shape first.
 */
export function matchFontsToGlyphs(input: {
  text: string
  scan: BinaryMask
  scanInk: InkBox
  pixelsPerPoint: number
  candidates: readonly FontShapeCandidate[]
  rasterize: GlyphRasterizer
}): FontShapeMatch[] {
  const text = input.text.trim()
  if (!text || input.scanInk.height < 3) {
    return []
  }
  const matches: FontShapeMatch[] = []
  for (const candidate of input.candidates) {
    const probe = input.rasterize(text, candidate.family, candidate.weight, PROBE_SIZE_PX)
    const probeInk = probe ? inkBounds(probe) : null
    if (!probe || !probeInk) {
      continue
    }
    const sizePx = (PROBE_SIZE_PX * input.scanInk.height) / probeInk.height
    const rendered = input.rasterize(text, candidate.family, candidate.weight, sizePx)
    const renderedInk = rendered ? inkBounds(rendered) : null
    if (!rendered || !renderedInk) {
      continue
    }
    matches.push({
      ...candidate,
      similarity: maskSimilarity(input.scan, input.scanInk, rendered, renderedInk),
      widthRatio: renderedInk.width / input.scanInk.width,
      impliedSizePt: sizePx / input.pixelsPerPoint,
    })
  }
  return matches.sort((a, b) => b.similarity - a.similarity)
}
