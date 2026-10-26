import type { PageViewport } from 'pdfjs-dist'
import { describe, expect, it } from 'vitest'
import { parseOcrPageToItems } from '@/lib/ocr/parseOcrWords'
import { createPageDisplayTransform } from '@/lib/pdf'

const viewport = {
  width: 612,
  height: 792,
  scale: 1,
  rotation: 0,
  transform: [1, 0, 0, -1, 0, 792],
  convertToPdfPoint: (x: number, y: number) => [x, 792 - y],
} as PageViewport

const displayTransform = createPageDisplayTransform(0, viewport)

describe('parseOcrPageToItems', () => {
  it('maps word boxes to PDF-space items with confidence', () => {
    const page = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    {
                      text: '$4.99',
                      confidence: 72,
                      bbox: { x0: 10, y0: 20, x1: 60, y1: 36 },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as Parameters<typeof parseOcrPageToItems>[0]

    const items = parseOcrPageToItems(page, 0, displayTransform, { x: 0, y: 0 })
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe('$4.99')
    expect(items[0]?.confidence).toBe(72)
    expect(items[0]?.tags).toContain('price')
    expect(items[0]?.bounds.width).toBeGreaterThan(0)
  })
})
