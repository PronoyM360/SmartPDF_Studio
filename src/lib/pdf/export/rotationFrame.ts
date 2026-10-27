import type { PagePoint, PageRect } from '@/types'

export type QuarterTurn = 0 | 90 | 180 | 270

export function normalizePageRotation(angle: number): QuarterTurn {
  const quarter = Math.round(angle / 90) * 90
  return ((((quarter % 360) + 360) % 360) as QuarterTurn)
}

/** Size of a user-space box as it appears on screen once the page /Rotate is applied. */
export function displaySize(
  width: number,
  height: number,
  rotation: QuarterTurn,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height }
}

export type CanvasMatrix = readonly [number, number, number, number, number, number]

/**
 * Canvas matrix from display-local coordinates (origin at the box's on-screen top-left,
 * y down) to image-local coordinates of an unrotated raster of the same box (origin at
 * the user-space top-left, y down). Content drawn through it looks upright after the
 * viewer applies the page /Rotate (clockwise).
 */
export function displayToImageMatrix(
  width: number,
  height: number,
  rotation: QuarterTurn,
): CanvasMatrix {
  switch (rotation) {
    case 90:
      return [0, -1, 1, 0, 0, height]
    case 180:
      return [-1, 0, 0, -1, width, height]
    case 270:
      return [0, 1, -1, 0, width, 0]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

/** User-space rect → display-local rect inside `frame` (both in PDF user space). */
export function userRectToDisplayLocal(
  rect: PageRect,
  frame: PageRect,
  rotation: QuarterTurn,
): PageRect {
  const lx = rect.x - frame.x
  const ly = frame.y + frame.height - (rect.y + rect.height)
  const { width: w, height: h } = rect
  switch (rotation) {
    case 90:
      return { x: frame.height - ly - h, y: lx, width: h, height: w }
    case 180:
      return { x: frame.width - lx - w, y: frame.height - ly - h, width: w, height: h }
    case 270:
      return { x: ly, y: frame.width - lx - w, width: h, height: w }
    default:
      return { x: lx, y: ly, width: w, height: h }
  }
}

/**
 * pdf-lib `drawImage` options that make a display-oriented image fill `bounds` and look
 * upright once the viewer rotates the page. pdf-lib rotates counter-clockwise about
 * (x, y), the image's bottom-left corner.
 */
export function rotatedImagePlacement(
  bounds: PageRect,
  rotation: QuarterTurn,
): { x: number; y: number; width: number; height: number; rotateDegrees: number } {
  const { x, y, width, height } = bounds
  switch (rotation) {
    case 90:
      return { x: x + width, y, width: height, height: width, rotateDegrees: 90 }
    case 180:
      return { x: x + width, y: y + height, width, height, rotateDegrees: 180 }
    case 270:
      return { x, y: y + height, width: height, height: width, rotateDegrees: 270 }
    default:
      return { x, y, width, height, rotateDegrees: 0 }
  }
}

/** Display-local point inside `frame` → PDF user-space point. */
export function displayLocalPointToUser(
  point: PagePoint,
  frame: PageRect,
  rotation: QuarterTurn,
): PagePoint {
  const [a, b, c, d, e, f] = displayToImageMatrix(frame.width, frame.height, rotation)
  const ix = a * point.x + c * point.y + e
  const iy = b * point.x + d * point.y + f
  return { x: frame.x + ix, y: frame.y + frame.height - iy }
}
