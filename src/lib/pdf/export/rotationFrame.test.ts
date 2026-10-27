import { describe, expect, it } from 'vitest'
import {
  displayLocalPointToUser,
  displaySize,
  displayToImageMatrix,
  normalizePageRotation,
  rotatedImagePlacement,
  userRectToDisplayLocal,
  type QuarterTurn,
} from '@/lib/pdf/export/rotationFrame'

const PAGE = { x: 0, y: 0, width: 400, height: 600 }
const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270]

interface ReferenceViewport {
  width: number
  height: number
  convertToViewportPoint: (x: number, y: number) => number[]
  convertToPdfPoint: (x: number, y: number) => number[]
}

/** Same transform as PDF.js `PageViewport` (scale 1, no offsets, viewBox at origin). */
function viewportFor(rotation: QuarterTurn): ReferenceViewport {
  const [rotateA, rotateB, rotateC, rotateD] = {
    0: [1, 0, 0, -1],
    90: [0, 1, 1, 0],
    180: [-1, 0, 0, 1],
    270: [0, -1, -1, 0],
  }[rotation] as [number, number, number, number]
  const centerX = PAGE.width / 2
  const centerY = PAGE.height / 2
  const swapped = rotation === 90 || rotation === 270
  const offsetCanvasX = swapped ? centerY : centerX
  const offsetCanvasY = swapped ? centerX : centerY
  const t = [
    rotateA,
    rotateB,
    rotateC,
    rotateD,
    offsetCanvasX - rotateA * centerX - rotateC * centerY,
    offsetCanvasY - rotateB * centerX - rotateD * centerY,
  ] as const
  const det = t[0] * t[3] - t[1] * t[2]
  return {
    width: swapped ? PAGE.height : PAGE.width,
    height: swapped ? PAGE.width : PAGE.height,
    convertToViewportPoint: (x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]],
    convertToPdfPoint: (x, y) => [
      (t[3] * (x - t[4]) - t[2] * (y - t[5])) / det,
      (-t[1] * (x - t[4]) + t[0] * (y - t[5])) / det,
    ],
  }
}

function viewportRect(viewport: ReferenceViewport, rect: typeof PAGE) {
  const corners = [
    viewport.convertToViewportPoint(rect.x, rect.y),
    viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map((point) => point[0]!)
  const ys = corners.map((point) => point[1]!)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

describe('rotationFrame', () => {
  it('normalizes /Rotate values', () => {
    expect(normalizePageRotation(-90)).toBe(270)
    expect(normalizePageRotation(450)).toBe(90)
    expect(normalizePageRotation(0)).toBe(0)
  })

  it.each(ROTATIONS)('maps user rects like the PDF.js viewport at %i°', (rotation) => {
    const viewport = viewportFor(rotation)
    const rect = { x: 40, y: 500, width: 90, height: 20 }
    const expected = viewportRect(viewport, rect)
    const actual = userRectToDisplayLocal(rect, PAGE, rotation)
    expect(actual.x).toBeCloseTo(expected.x)
    expect(actual.y).toBeCloseTo(expected.y)
    expect(actual.width).toBeCloseTo(expected.width)
    expect(actual.height).toBeCloseTo(expected.height)
    expect(displaySize(PAGE.width, PAGE.height, rotation)).toEqual({
      width: viewport.width,
      height: viewport.height,
    })
  })

  it.each(ROTATIONS)('round-trips display points back to user space at %i°', (rotation) => {
    const viewport = viewportFor(rotation)
    const display = { x: 37, y: 81 }
    const [ux, uy] = viewport.convertToPdfPoint(display.x, display.y)
    const user = displayLocalPointToUser(display, PAGE, rotation)
    expect(user.x).toBeCloseTo(ux!)
    expect(user.y).toBeCloseTo(uy!)
  })

  it('keeps the unrotated matrix as identity', () => {
    expect(displayToImageMatrix(10, 20, 0)).toEqual([1, 0, 0, 1, 0, 0])
  })

  it.each(ROTATIONS)('places rotated images over their bounds with the top edge on top at %i°', (rotation) => {
    const bounds = { x: 100, y: 200, width: 60, height: 20 }
    const placement = rotatedImagePlacement(bounds, rotation)
    const theta = (placement.rotateDegrees * Math.PI) / 180
    const cos = Math.round(Math.cos(theta))
    const sin = Math.round(Math.sin(theta))
    // Same transform as pdf-lib: translate · rotate · scale applied to the unit square.
    const map = (u: number, v: number) => ({
      x: placement.x + cos * u * placement.width - sin * v * placement.height,
      y: placement.y + sin * u * placement.width + cos * v * placement.height,
    })
    const corners = [map(0, 0), map(1, 0), map(0, 1), map(1, 1)]
    const xs = corners.map((point) => point.x)
    const ys = corners.map((point) => point.y)
    expect(Math.min(...xs)).toBeCloseTo(bounds.x)
    expect(Math.max(...xs)).toBeCloseTo(bounds.x + bounds.width)
    expect(Math.min(...ys)).toBeCloseTo(bounds.y)
    expect(Math.max(...ys)).toBeCloseTo(bounds.y + bounds.height)

    // The image's top-left corner must land on the display top-left of the box.
    const viewport = viewportFor(rotation)
    const topLeft = map(0, 1)
    const [dx, dy] = viewport.convertToViewportPoint(topLeft.x, topLeft.y)
    const display = viewportRect(viewport, bounds)
    expect(dx).toBeCloseTo(display.x)
    expect(dy).toBeCloseTo(display.y)
  })
})
