import { describe, expect, it } from 'vitest'
import {
  inkBounds,
  matchFontsToGlyphs,
  type BinaryMask,
  type GlyphRasterizer,
} from '@/lib/ocr/fontShapeMatch'

/** "Glyphs" are vertical bars: each font has its own bar width and gap, bold doubles bars. */
function bars(count: number, bar: number, gap: number, height: number, pad = 2): BinaryMask {
  const width = pad * 2 + count * (bar + gap)
  const data = new Uint8Array(width * (height + pad * 2))
  for (let i = 0; i < count; i += 1) {
    for (let x = 0; x < bar; x += 1) {
      for (let y = 0; y < height; y += 1) {
        data[(y + pad) * width + pad + i * (bar + gap) + x] = 1
      }
    }
  }
  return { data, width, height: height + pad * 2 }
}

const FONTS: Record<string, { bar: number; gap: number }> = {
  Narrow: { bar: 0.08, gap: 0.3 },
  Match: { bar: 0.1, gap: 0.45 },
  Wide: { bar: 0.1, gap: 0.7 },
}

const rasterize: GlyphRasterizer = (text, family, weight, sizePx) => {
  const font = FONTS[family]
  if (!font) {
    return null
  }
  const bar = Math.max(1, Math.round(sizePx * font.bar * (weight === 'bold' ? 2 : 1)))
  return bars(text.length, bar, Math.round(sizePx * font.gap), Math.round(sizePx * 0.7))
}

describe('matchFontsToGlyphs', () => {
  it('finds the font and weight whose glyphs overlap the scan best', () => {
    // Scan = "Match" at 40 px, bold.
    const scan = rasterize('12345', 'Match', 'bold', 40)!
    const matches = matchFontsToGlyphs({
      text: '12345',
      scan,
      scanInk: inkBounds(scan)!,
      pixelsPerPoint: 4,
      candidates: ['Narrow', 'Match', 'Wide', 'Missing'].flatMap((family) => [
        { family, weight: 'normal' as const },
        { family, weight: 'bold' as const },
      ]),
      rasterize,
    })
    expect(matches[0]).toMatchObject({ family: 'Match', weight: 'bold' })
    expect(matches[0]!.similarity).toBeGreaterThan(0.85)
    expect(matches[0]!.impliedSizePt).toBeCloseTo(10, 0)
    expect(matches.find((match) => match.family === 'Wide')!.widthRatio).toBeGreaterThan(1.2)
    expect(matches.some((match) => match.family === 'Missing')).toBe(false)
  })

  it('returns nothing without measurable ink', () => {
    const empty: BinaryMask = { data: new Uint8Array(4), width: 2, height: 2 }
    expect(
      matchFontsToGlyphs({
        text: 'x',
        scan: empty,
        scanInk: { x: 0, y: 0, width: 2, height: 2 },
        pixelsPerPoint: 1,
        candidates: [{ family: 'Match', weight: 'normal' }],
        rasterize,
      }),
    ).toEqual([])
  })
})
