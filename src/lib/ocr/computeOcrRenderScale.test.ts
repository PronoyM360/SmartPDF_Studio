import { describe, expect, it } from 'vitest'
import { computeOcrRenderScale } from '@/lib/ocr/computeOcrRenderScale'
import { DEFAULT_OCR_RENDER_SCALE } from '@/lib/ocr/renderPageForOcr'

describe('computeOcrRenderScale', () => {
  const page = { pageWidthPt: 612, pageHeightPt: 792 }

  it('uses default scale for full page', () => {
    expect(
      computeOcrRenderScale({ cropPdfRect: null, ...page }),
    ).toBe(DEFAULT_OCR_RENDER_SCALE)
  })

  it('boosts scale for a small price-sized crop', () => {
    const scale = computeOcrRenderScale({
      cropPdfRect: { x: 100, y: 200, width: 40, height: 14 },
      ...page,
    })
    expect(scale).toBeGreaterThan(DEFAULT_OCR_RENDER_SCALE)
  })
})
