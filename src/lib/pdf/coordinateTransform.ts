import type { PageViewport } from 'pdfjs-dist'
import type { PagePoint, PageRect } from '@/types'

export interface PageDisplayTransform {
  readonly pageIndex: number
  readonly viewport: PageViewport
  readonly cssWidth: number
  readonly cssHeight: number
  readonly scale: number
  readonly rotation: number
}

export function createPageDisplayTransform(
  pageIndex: number,
  viewport: PageViewport,
): PageDisplayTransform {
  return {
    pageIndex,
    viewport,
    cssWidth: viewport.width,
    cssHeight: viewport.height,
    scale: viewport.scale,
    rotation: viewport.rotation,
  }
}

/** Screen/canvas coordinates (top-left origin) → PDF user space (bottom-left origin). */
export function screenPointToPdfPoint(
  transform: PageDisplayTransform,
  screenPoint: PagePoint,
): PagePoint {
  const [pdfX, pdfY] = transform.viewport.convertToPdfPoint(
    screenPoint.x,
    screenPoint.y,
  )
  return { x: pdfX, y: pdfY }
}

/** PDF user space → screen/canvas coordinates (top-left origin). */
export function pdfPointToScreenPoint(
  transform: PageDisplayTransform,
  pdfPoint: PagePoint,
): PagePoint {
  const [screenX, screenY] = transform.viewport.convertToViewportPoint(
    pdfPoint.x,
    pdfPoint.y,
  )
  return { x: screenX, y: screenY }
}

export function pdfRectToScreenRect(
  transform: PageDisplayTransform,
  rect: PageRect,
): PageRect {
  const topLeft = pdfPointToScreenPoint(transform, {
    x: rect.x,
    y: rect.y + rect.height,
  })
  const bottomRight = pdfPointToScreenPoint(transform, {
    x: rect.x + rect.width,
    y: rect.y,
  })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

/**
 * PDF user-space rect → normalized screen box (positive width/height) that stays
 * correct on 90°/270° rotated pages, where corner order flips.
 */
export function pdfRectToScreenBounds(
  transform: PageDisplayTransform,
  rect: PageRect,
): PageRect {
  const corners = [
    pdfPointToScreenPoint(transform, { x: rect.x, y: rect.y }),
    pdfPointToScreenPoint(transform, { x: rect.x + rect.width, y: rect.y }),
    pdfPointToScreenPoint(transform, { x: rect.x, y: rect.y + rect.height }),
    pdfPointToScreenPoint(transform, {
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    }),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }
}

/** Screen-aligned box (top-left origin) → PDF user-space bounds (lower-left origin). */
export function screenRectToPdfRect(
  transform: PageDisplayTransform,
  screenRect: PageRect,
): PageRect {
  const topLeft = screenPointToPdfPoint(transform, {
    x: screenRect.x,
    y: screenRect.y,
  })
  const topRight = screenPointToPdfPoint(transform, {
    x: screenRect.x + screenRect.width,
    y: screenRect.y,
  })
  const bottomLeft = screenPointToPdfPoint(transform, {
    x: screenRect.x,
    y: screenRect.y + screenRect.height,
  })
  const bottomRight = screenPointToPdfPoint(transform, {
    x: screenRect.x + screenRect.width,
    y: screenRect.y + screenRect.height,
  })

  const xs = [topLeft.x, topRight.x, bottomLeft.x, bottomRight.x]
  const ys = [topLeft.y, topRight.y, bottomLeft.y, bottomRight.y]
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function computeFitScale(
  pageWidth: number,
  pageHeight: number,
  containerWidth: number,
  containerHeight: number,
  mode: 'page' | 'width',
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || containerWidth <= 0) {
    return 1
  }
  if (mode === 'width') {
    return containerWidth / pageWidth
  }
  const height = containerHeight > 0 ? containerHeight : containerWidth * 1.3
  return Math.min(containerWidth / pageWidth, height / pageHeight)
}
