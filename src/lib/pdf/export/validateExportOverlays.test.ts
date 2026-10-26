import { describe, expect, it } from 'vitest'
import { validateExportOverlays } from '@/lib/pdf/export/validateExportOverlays'
import type { TextOverlayObject } from '@/types/textOverlay'

function textOverlay(
  partial: Partial<TextOverlayObject> & Pick<TextOverlayObject, 'id' | 'pageIndex'>,
): TextOverlayObject {
  const now = Date.now()
  return {
    kind: 'text',
    bounds: { x: 10, y: 20, width: 80, height: 14 },
    content: '5884',
    fontFamily: 'Helvetica',
    fontSize: 12,
    color: '#16a34a',
    alignment: 'left',
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

describe('validateExportOverlays', () => {
  it('dedupes overlays by id', () => {
    const a = textOverlay({ id: 'a', pageIndex: 0, content: 'first' })
    const b = { ...a, content: 'second', updatedAt: a.updatedAt + 1 }
    const result = validateExportOverlays([a, b], 1, () => undefined)
    expect(result.exportableOverlays).toHaveLength(1)
    expect(result.exportableOverlays[0]?.content).toBe('second')
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true)
  })

  it('skips overlays on invalid pages', () => {
    const result = validateExportOverlays(
      [textOverlay({ id: 'a', pageIndex: 3 })],
      2,
      () => undefined,
    )
    expect(result.exportableOverlays).toHaveLength(0)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
