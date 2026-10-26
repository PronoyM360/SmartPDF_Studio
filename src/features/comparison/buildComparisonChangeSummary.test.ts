import { describe, expect, it } from 'vitest'
import { buildComparisonChangeSummary } from '@/features/comparison/buildComparisonChangeSummary'
import type { TextOverlayObject } from '@/types/textOverlay'

function textOverlay(partial: Partial<TextOverlayObject>): TextOverlayObject {
  return {
    id: partial.id ?? 't1',
    kind: 'text',
    pageIndex: partial.pageIndex ?? 0,
    bounds: partial.bounds ?? { x: 0, y: 0, width: 100, height: 40 },
    content: partial.content ?? 'Hello',
    fontFamily: 'Helvetica',
    fontSize: 12,
    color: '#000000',
    alignment: 'left',
    createdAt: partial.createdAt ?? 1000,
    updatedAt: partial.updatedAt ?? 1000,
  }
}

describe('buildComparisonChangeSummary', () => {
  it('counts added vs updated overlays from timestamps', () => {
    const summary = buildComparisonChangeSummary(
      [
        textOverlay({ id: 'a', createdAt: 1000, updatedAt: 1000 }),
        textOverlay({ id: 'b', createdAt: 1000, updatedAt: 2500 }),
      ],
      {},
      false,
    )
    expect(summary.textAdded).toBe(1)
    expect(summary.textUpdated).toBe(1)
    expect(summary.pagesWithOverlays).toEqual([1])
    expect(summary.nativePdfTextChanges).toBeNull()
  })
})
