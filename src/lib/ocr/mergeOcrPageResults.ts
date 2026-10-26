import type { OcrPageResult, OcrTextItem } from '@/types/ocr'
import type { PageRect } from '@/types'

function expandRect(rect: PageRect, padding: number): PageRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

function rectsIntersect(a: PageRect, b: PageRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function itemOverlapsRegion(item: OcrTextItem, region: PageRect): boolean {
  return rectsIntersect(item.bounds, expandRect(region, 2))
}

/** Replaces overlapping items when OCR runs on a sub-region; full-page OCR replaces all. */
export function mergeOcrPageResults(
  existing: OcrPageResult | null,
  incoming: OcrPageResult,
): OcrPageResult {
  if (!incoming.regionBounds) {
    return incoming
  }
  if (!existing || existing.pageIndex !== incoming.pageIndex) {
    return incoming
  }

  const region = incoming.regionBounds
  const kept = existing.items.filter((item) => !itemOverlapsRegion(item, region))

  return {
    ...incoming,
    items: [...kept, ...incoming.items],
  }
}
