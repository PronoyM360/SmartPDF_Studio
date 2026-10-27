import { describe, expect, it } from 'vitest'
import {
  analyzeRegionBackground,
  autoRepairMethod,
  repairBackground,
  type PixelRect,
  type RgbaImage,
} from '@/lib/ocr/backgroundRepair'

type Rgb = [number, number, number]

function makeImage(width: number, height: number, paint: (x: number, y: number) => Rgb): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y)
      const offset = (y * width + x) * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }
  }
  return { data, width, height }
}

const TEXT: PixelRect = { x: 20, y: 10, width: 40, height: 14 }

/** Two vertical strokes and a bar, like a crude "H", inside TEXT. */
function isGlyph(x: number, y: number): boolean {
  const inBox = x >= 24 && x < 56 && y >= 12 && y < 22
  return inBox && (x < 27 || x >= 53 || (y >= 16 && y < 18))
}

function rgbAt(image: { data: Uint8ClampedArray; width: number }, x: number, y: number): Rgb {
  const offset = (y * image.width + x) * 4
  return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!]
}

function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3]!
}

function noise(x: number, y: number): number {
  return ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1
}

describe('analyzeRegionBackground', () => {
  it('detects solid paper and isolates the glyph pixels', () => {
    const image = makeImage(80, 34, (x, y) => (isGlyph(x, y) ? [20, 20, 20] : [250, 250, 248]))
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.kind).toBe('solid')
    expect(analysis.backgroundColor).toBe('#fafaf8')
    expect(analysis.inkColor).toBe('#141414')
    expect(analysis.repairMask[16 * 80 + 25]).toBe(1)
    expect(analysis.repairMask[5 * 80 + 5]).toBe(0)
    expect(autoRepairMethod(analysis.kind)).toBe('solid')
  })

  it('keeps coloured ticket backgrounds and ink colours', () => {
    const image = makeImage(80, 34, (x, y) => (isGlyph(x, y) ? [150, 20, 30] : [253, 230, 138]))
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.kind).toBe('solid')
    expect(analysis.backgroundColor).toBe('#fde68a')
    expect(analysis.inkColor).toBe('#96141e')
  })

  it('recognizes gradients', () => {
    const image = makeImage(80, 34, (x, y) => {
      const shade = 120 + x * 1.5
      return isGlyph(x, y) ? [0, 0, 0] : [shade, shade, 255]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.kind).toBe('gradient')
    expect(autoRepairMethod(analysis.kind)).toBe('gradient')
  })

  it('keeps table rules that cross the text box', () => {
    const image = makeImage(80, 34, (x, y) => {
      if (y === 23) {
        return [0, 0, 0]
      }
      return isGlyph(x, y) ? [30, 30, 30] : [255, 255, 255]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.kind).toBe('lines')
    expect(analysis.crossingLineRows).toContain(23)
    expect(analysis.repairMask[23 * 80 + 40]).toBe(0)
    expect(analysis.warnings.join(' ')).toContain('lines cross')
  })

  it('flags barcodes next to the text as complex', () => {
    const image = makeImage(80, 34, (x, y) => {
      if (y >= 26 || y < 6) {
        return x % 3 === 0 ? [0, 0, 0] : [255, 255, 255]
      }
      return isGlyph(x, y) ? [0, 0, 0] : [255, 255, 255]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.kind).toBe('complex')
    expect(analysis.warnings.join(' ')).toContain('cannot recreate')
  })

  it('treats photo-like noise as textured or complex, never solid', () => {
    const image = makeImage(80, 34, (x, y) => {
      if (isGlyph(x, y)) {
        return [255, 255, 255]
      }
      const value = 90 + noise(x, y) * 60
      return [value, value * 0.8, value * 0.6]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(['textured', 'complex']).toContain(analysis.kind)
  })

  it('repairs only the glyphs on noisy backgrounds, not the whole box', () => {
    const image = makeImage(80, 34, (x, y) => {
      if (isGlyph(x, y)) {
        return [255, 255, 255]
      }
      const value = 60 + noise(x, y) * 36
      return [value * 0.4, value * 0.9, value * 1.6]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    expect(analysis.repairMask[16 * 80 + 25]).toBe(1)
    // Background pixels 4+ px from any stroke keep their original texture.
    for (const [x, y] of [[40, 11], [40, 21], [36, 21], [45, 11]] as const) {
      expect(analysis.repairMask[y * 80 + x]).toBe(0)
    }
    expect(analysis.inkColor).toBe('#ffffff')
  })
})

describe('repairBackground', () => {
  it('rebuilds only glyph pixels and leaves the rest transparent', () => {
    const image = makeImage(80, 34, (x, y) => (isGlyph(x, y) ? [20, 20, 20] : [250, 250, 248]))
    const analysis = analyzeRegionBackground(image, TEXT)
    const result = repairBackground(image, analysis, 'solid')
    expect(alphaAt(result.pixels, 80, 5, 5)).toBe(0)
    expect(alphaAt(result.pixels, 80, 40, 13)).toBe(0)
    expect(alphaAt(result.pixels, 80, 25, 16)).toBe(255)
    expect(rgbAt({ data: result.pixels, width: 80 }, 25, 16)).toEqual([250, 250, 248])
    expect(result.repairedBounds).not.toBeNull()
    expect(result.seamScore).toBeLessThan(2)
  })

  it('follows gradients instead of painting a flat colour', () => {
    const image = makeImage(80, 34, (x, y) => {
      const shade = 120 + x * 1.5
      return isGlyph(x, y) ? [0, 0, 0] : [shade, shade, 255]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    const result = repairBackground(image, analysis, 'gradient')
    const left = rgbAt({ data: result.pixels, width: 80 }, 25, 16)
    const right = rgbAt({ data: result.pixels, width: 80 }, 54, 16)
    expect(Math.abs(left[0] - (120 + 25 * 1.5))).toBeLessThanOrEqual(2)
    expect(Math.abs(right[0] - (120 + 54 * 1.5))).toBeLessThanOrEqual(2)
  })

  it('inpaints from neighbouring pixels on uneven backgrounds', () => {
    // Top half blue, bottom half yellow: a plane cannot represent the edge, inpainting can.
    const image = makeImage(80, 34, (x, y) => {
      if (isGlyph(x, y)) {
        return [0, 0, 0]
      }
      return y < 17 ? [60, 90, 200] : [240, 220, 80]
    })
    const analysis = analyzeRegionBackground(image, TEXT)
    const result = repairBackground(image, analysis, 'inpaint')
    const top = rgbAt({ data: result.pixels, width: 80 }, 25, 13)
    const bottom = rgbAt({ data: result.pixels, width: 80 }, 25, 20)
    expect(top[2]).toBeGreaterThan(top[0])
    expect(bottom[0]).toBeGreaterThan(bottom[2])
    expect(result.notes.join(' ')).toMatch(/colour step/)
  })
})
