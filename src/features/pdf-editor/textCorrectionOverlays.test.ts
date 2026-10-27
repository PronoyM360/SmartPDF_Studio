import { describe, expect, it } from 'vitest'
import { buildTextCorrectionOverlays } from '@/features/pdf-editor/textCorrectionOverlays'

const base = {
  pageIndex: 0,
  originalText: '9',
  replacementText: '8',
  fontSizeHint: 10,
}

describe('buildTextCorrectionOverlays', () => {
  it('draws the reconstructed patch instead of a filled text box for OCR edits', () => {
    const [mask, text] = buildTextCorrectionOverlays({
      ...base,
      bounds: { x: 100, y: 100, width: 6, height: 12 },
      maskBounds: { x: 99, y: 99, width: 8, height: 14 },
      alignment: 'right',
      maskBackgroundPatch: { assetId: 'asset', method: 'inpaint', backgroundKind: 'textured' },
      ocrEdit: { recognizedText: '9', confidence: 80, backgroundKind: 'textured', repairMethod: 'inpaint' },
    })
    expect(mask.backgroundPatch?.assetId).toBe('asset')
    expect(mask.opacity).toBe(1)
    expect(text.backgroundColor).toBeUndefined()
    expect(text.bounds).toEqual({ x: 100, y: 100, width: 6, height: 12 })
    expect(text.ocrEdit?.repairMethod).toBe('inpaint')
  })

  it('widens short boxes around the anchored edge', () => {
    const [, right] = buildTextCorrectionOverlays({
      ...base,
      bounds: { x: 100, y: 100, width: 6, height: 12 },
      alignment: 'right',
    })
    expect(right.bounds.x + right.bounds.width).toBeCloseTo(106)
    const [, left] = buildTextCorrectionOverlays({
      ...base,
      bounds: { x: 100, y: 100, width: 6, height: 12 },
      alignment: 'left',
    })
    expect(left.bounds.x).toBe(100)
    expect(left.backgroundColor).toBe('#ffffff')
  })
})
