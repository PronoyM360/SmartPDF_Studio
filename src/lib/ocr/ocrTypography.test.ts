import { describe, expect, it } from 'vitest'
import {
  estimateFontWeight,
  estimateGlyphMetrics,
  harmonizeLineFontSizes,
  inferOcrAlignment,
  layoutOcrReplacement,
  rankFontsByWidth,
} from '@/lib/ocr/ocrTypography'

describe('estimateGlyphMetrics', () => {
  it('reads digit boxes as cap height', () => {
    // 36 px tall digits ≈ 50 px font.
    const metrics = estimateGlyphMetrics({ text: '1,250.00', bbox: { x0: 0, y0: 100, x1: 160, y1: 136 } })
    expect(metrics.fontSizePx).toBeCloseTo(36 / (0.72 + 0.21), 0)
  })

  it('uses the line baseline when Tesseract provides one', () => {
    const metrics = estimateGlyphMetrics({
      text: 'Total',
      bbox: { x0: 10, y0: 100, x1: 90, y1: 136 },
      lineBaseline: { x0: 0, y0: 136, x1: 400, y1: 136 },
    })
    expect(metrics.baselineFromTopPx).toBeCloseTo(36)
    expect(metrics.fontSizePx).toBeCloseTo(50, 0)
  })

  it('does not mistake x-height words for small text', () => {
    const metrics = estimateGlyphMetrics({ text: 'acme', bbox: { x0: 0, y0: 0, x1: 60, y1: 26 } })
    expect(metrics.fontSizePx).toBeCloseTo(50, 0)
  })

  it('aligns outliers on a line to the median size', () => {
    const harmonized = harmonizeLineFontSizes([
      { fontSizePx: 50, baselineFromTopPx: 36, reliable: true },
      { fontSizePx: 51, baselineFromTopPx: 37, reliable: true },
      { fontSizePx: 12, baselineFromTopPx: 8, reliable: false },
    ])
    expect(harmonized[2]?.fontSizePx).toBe(51)
  })
})

describe('estimateFontWeight', () => {
  it('suggests bold only for heavy strokes at readable sizes', () => {
    expect(estimateFontWeight(8, 50).weight).toBe('bold')
    expect(estimateFontWeight(4.5, 50).weight).toBe('normal')
    expect(estimateFontWeight(3, 12).weight).toBe('normal')
  })
})

describe('rankFontsByWidth', () => {
  it('prefers the font whose width matches the scanned glyphs', () => {
    const perChar: Record<string, number> = { Narrow: 0.45, Wide: 0.7, Mono: 0.6 }
    const ranked = rankFontsByWidth({
      text: 'TOTAL 12.50',
      boxWidth: 11 * 0.6 * 10,
      fontSize: 10,
      fontWeight: 'normal',
      families: ['Narrow', 'Wide', 'Mono', 'Missing'],
      measure: (text, family, _weight, size) =>
        perChar[family] ? text.length * perChar[family]! * size : null,
    })
    expect(ranked.map((match) => match.family)).toEqual(['Mono', 'Wide', 'Narrow'])
    expect(ranked[0]?.widthRatio).toBeCloseTo(1)
  })
})

describe('inferOcrAlignment', () => {
  it('detects right-aligned price columns', () => {
    const target = { x: 400, y: 300, width: 40, height: 10 }
    const neighbors = [
      { text: '12.50', box: { x: 410, y: 280, width: 30, height: 10 } },
      { text: '102.00', box: { x: 404, y: 260, width: 36, height: 10 } },
      { text: 'Coffee', box: { x: 60, y: 300, width: 50, height: 10 } },
    ]
    expect(inferOcrAlignment(target, neighbors, 12).alignment).toBe('right')
  })

  it('defaults to left without evidence', () => {
    expect(inferOcrAlignment({ x: 10, y: 10, width: 40, height: 10 }, [], 12).alignment).toBe('left')
  })
})

describe('layoutOcrReplacement', () => {
  const base = {
    original: { x: 400, y: 300, width: 40, height: 10 },
    baselineFromTop: 10,
    fontSize: 14,
    ascentFromTop: 12,
    neighbors: [{ text: 'Qty 2', box: { x: 340, y: 300, width: 40, height: 10 } }],
    page: { width: 612, height: 792 },
  }

  it('keeps the baseline and right edge for right-aligned values', () => {
    const layout = layoutOcrReplacement({ ...base, replacementWidth: 30, alignment: 'right', overflow: 'extend' })
    expect(layout.textBox.x + layout.textBox.width).toBeCloseTo(440)
    expect(layout.textBox.y + 12).toBeCloseTo(310)
    expect(layout.warnings).toHaveLength(0)
  })

  it('warns when a longer value would overlap its neighbour', () => {
    const layout = layoutOcrReplacement({ ...base, replacementWidth: 90, alignment: 'right', overflow: 'extend' })
    expect(layout.overlaps).toEqual(['Qty 2'])
    expect(layout.warnings.join(' ')).toContain('wider than the original')
    expect(layout.fitScale).toBe(1)
  })

  it('scales uniformly only when asked to fit', () => {
    const layout = layoutOcrReplacement({ ...base, replacementWidth: 80, alignment: 'right', overflow: 'fit' })
    expect(layout.fitScale).toBeCloseTo(0.5)
    expect(layout.fontSize).toBeCloseTo(7)
    expect(layout.overlaps).toHaveLength(0)
    expect(layout.warnings.join(' ')).toContain('noticeably smaller')
  })

  it('flags text running off the page', () => {
    const layout = layoutOcrReplacement({
      ...base,
      original: { x: 580, y: 300, width: 20, height: 10 },
      neighbors: [],
      replacementWidth: 60,
      alignment: 'left',
      overflow: 'extend',
    })
    expect(layout.offPage).toBe(true)
  })
})
