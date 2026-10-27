import { describe, expect, it } from 'vitest'
import {
  createPageDisplayTransform,
  pdfRectToScreenBounds,
  screenRectToPdfRect,
} from '@/lib/pdf'
import type { QuarterTurn } from '@/lib/pdf/export/rotationFrame'
import {
  clampRegionToPage,
  formatRegionSize,
  pageBoxFromView,
  rectFromCorners,
  regionDimensions,
  textInsideRegion,
} from '@/lib/regionSelection/regionGeometry'
import type { PageViewport } from 'pdfjs-dist'

/** PDF.js `PageViewport` transform for a page box at the origin. */
function viewport(width: number, height: number, scale: number, rotation: QuarterTurn): PageViewport {
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotation]!
  const cx = width / 2
  const cy = height / 2
  const swapped = rotation === 90 || rotation === 270
  const ox = (swapped ? cy : cx) * scale
  const oy = (swapped ? cx : cy) * scale
  const t = [a! * scale, b! * scale, c! * scale, d! * scale, ox - a! * scale * cx - c! * scale * cy, oy - b! * scale * cx - d! * scale * cy]
  const det = t[0]! * t[3]! - t[1]! * t[2]!
  return {
    width: (swapped ? height : width) * scale,
    height: (swapped ? width : height) * scale,
    scale,
    rotation,
    transform: t,
    convertToViewportPoint: (x: number, y: number) => [t[0]! * x + t[2]! * y + t[4]!, t[1]! * x + t[3]! * y + t[5]!],
    convertToPdfPoint: (x: number, y: number) => [
      (t[3]! * (x - t[4]!) - t[2]! * (y - t[5]!)) / det,
      (-t[1]! * (x - t[4]!) + t[0]! * (y - t[5]!)) / det,
    ],
  } as unknown as PageViewport
}

const SIZES = [
  [612, 792],
  [420, 298],
  [842, 1191],
] as const
const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270]

describe('region selection geometry', () => {
  it.each(SIZES.flatMap(([w, h]) => ROTATIONS.map((rotation) => [w, h, rotation] as const)))(
    'keeps a %ix%i page selection fixed in PDF space across zoom (rotation %i°)',
    (width, height, rotation) => {
      const region = { x: 40, y: 60, width: 120, height: 30 }
      const boxes = [0.5, 1, 1.75, 3].map((scale) => {
        const transform = createPageDisplayTransform(0, viewport(width, height, scale, rotation))
        const screen = pdfRectToScreenBounds(transform, region)
        return { scale, screen, back: screenRectToPdfRect(transform, screen) }
      })
      for (const { scale, screen, back } of boxes) {
        expect(back.x).toBeCloseTo(region.x)
        expect(back.y).toBeCloseTo(region.y)
        expect(back.width).toBeCloseTo(region.width)
        expect(back.height).toBeCloseTo(region.height)
        const swapped = rotation === 90 || rotation === 270
        expect(screen.width).toBeCloseTo((swapped ? region.height : region.width) * scale)
      }
    },
  )

  it('reports dimensions as displayed on rotated pages', () => {
    const box = pageBoxFromView([0, 0, 420, 298])
    const region = { x: 10, y: 10, width: 72, height: 36 }
    expect(regionDimensions(region, box, 0)).toMatchObject({ widthPt: 72, heightPt: 36 })
    const rotated = regionDimensions(region, box, 90)
    expect(rotated).toMatchObject({ widthPt: 36, heightPt: 72 })
    expect(rotated.heightMm).toBeCloseTo(25.4)
    expect(formatRegionSize(rotated)).toBe('36 × 72 pt (12.7 × 25.4 mm)')
  })

  it('clamps to page boxes that do not start at the origin', () => {
    const box = pageBoxFromView([20, 30, 320, 430])
    expect(clampRegionToPage({ x: 300, y: 400, width: 50, height: 50 }, box, 'move')).toEqual({
      x: 270,
      y: 380,
      width: 50,
      height: 50,
    })
    expect(clampRegionToPage({ x: 300, y: 400, width: 50, height: 50 }, box, 'resize')).toEqual({
      x: 300,
      y: 400,
      width: 20,
      height: 30,
    })
    expect(clampRegionToPage({ x: 0, y: 0, width: 1, height: 1 }, box).width).toBe(4)
  })

  it('normalizes drags in any direction', () => {
    expect(rectFromCorners({ x: 50, y: 10 }, { x: 5, y: 40 })).toEqual({ x: 5, y: 10, width: 45, height: 30 })
  })

  it('collects text inside the region in reading order', () => {
    const items = [
      { text: 'Total', bounds: { x: 50, y: 100, width: 30, height: 10 } },
      { text: '9.99', bounds: { x: 200, y: 100, width: 25, height: 10 } },
      { text: 'Fare', bounds: { x: 50, y: 120, width: 25, height: 10 } },
      { text: 'Outside', bounds: { x: 400, y: 400, width: 40, height: 10 } },
    ]
    const toDisplay = (rect: { x: number; y: number; width: number; height: number }) => ({
      ...rect,
      y: 792 - rect.y - rect.height,
    })
    const result = textInsideRegion(items, { x: 40, y: 90, width: 200, height: 45 }, toDisplay)
    expect(result.text).toBe('Fare\nTotal 9.99')
    expect(result.items).toHaveLength(3)
  })
})
