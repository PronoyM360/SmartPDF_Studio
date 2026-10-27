import { describe, expect, it } from 'vitest'
import {
  classifyPageContent,
  collectImagePlacements,
  type ImageOpCodes,
} from '@/lib/ocr/pageContentKind'

const OPS: ImageOpCodes = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
}
const VIEW = [0, 0, 612, 792] as const

describe('collectImagePlacements', () => {
  it('places a full-page scan and reports its resolution', () => {
    // 2550×3300 px at 612×792 pt = 300 dpi.
    const placements = collectImagePlacements(
      [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
      [null, [612, 0, 0, 792, 0, 0], ['img_1', 2550, 3300], null],
      OPS,
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]?.bounds).toEqual({ x: 0, y: 0, width: 612, height: 792 })
    expect((placements[0]?.pixelsPerPoint ?? 0) * 72).toBeCloseTo(300, 0)
  })

  it('applies form matrices and rotated placements', () => {
    const placements = collectImagePlacements(
      [OPS.paintFormXObjectBegin, OPS.transform, OPS.paintInlineImageXObject, OPS.paintFormXObjectEnd],
      [[[1, 0, 0, 1, 100, 50], null], [0, 200, -100, 0, 100, 0], [{ width: 400, height: 200 }], null],
      OPS,
    )
    expect(placements[0]?.bounds).toEqual({ x: 100, y: 50, width: 100, height: 200 })
    expect(placements[0]?.pixelsPerPoint).toBeCloseTo(2)
  })
})

describe('classifyPageContent', () => {
  const scan = collectImagePlacements(
    [OPS.transform, OPS.paintImageXObject],
    [[612, 0, 0, 792, 0, 0], ['img', 612, 792]],
    OPS,
  )

  it('flags scanned pages without a text layer as image content', () => {
    const result = classifyPageContent({ pageIndex: 0, view: VIEW, textCharCount: 0, textArea: 0, images: scan })
    expect(result.kind).toBe('image')
    expect(result.imageAreaRatio).toBeCloseTo(1)
    expect(result.lowResolution).toBe(true)
    expect(result.summary).toContain('72 dpi')
  })

  it('treats scans with an OCR text layer as mixed', () => {
    const result = classifyPageContent({ pageIndex: 0, view: VIEW, textCharCount: 400, textArea: 90000, images: scan })
    expect(result.kind).toBe('mixed')
  })

  it('recognizes born-digital text pages', () => {
    const result = classifyPageContent({ pageIndex: 0, view: VIEW, textCharCount: 900, textArea: 120000, images: [] })
    expect(result.kind).toBe('text')
    expect(result.lowResolution).toBe(false)
  })

  it('reports pages with neither text nor images', () => {
    expect(classifyPageContent({ pageIndex: 0, view: VIEW, textCharCount: 0, textArea: 0, images: [] }).kind).toBe(
      'empty',
    )
  })
})
