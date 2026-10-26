import type { PageRect } from '@/types'

export interface PageSizePt {
  readonly width: number
  readonly height: number
}

/** Keeps overlay bounds on the page; preserves size when possible. */
export function clampPageRect(bounds: PageRect, page: PageSizePt): PageRect {
  if (page.width <= 0 || page.height <= 0) {
    return bounds
  }
  const width = Math.min(Math.max(bounds.width, 1), page.width)
  const height = Math.min(Math.max(bounds.height, 1), page.height)
  const x = Math.min(Math.max(bounds.x, 0), Math.max(0, page.width - width))
  const y = Math.min(Math.max(bounds.y, 0), Math.max(0, page.height - height))
  return { x, y, width, height }
}
