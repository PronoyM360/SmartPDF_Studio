import type { PageRect } from '@/types'

export function pageRectsIntersect(a: PageRect, b: PageRect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}
