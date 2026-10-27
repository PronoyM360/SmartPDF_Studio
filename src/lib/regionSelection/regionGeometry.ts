import type { PageRect } from '@/types'
import type { QuarterTurn } from '@/lib/pdf/export/rotationFrame'

/** Page box in PDF user space (`page.view`), which may not start at the origin. */
export interface PageBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const MIN_REGION_PT = 4

export function pageBoxFromView(view: readonly number[]): PageBox {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  }
}

/** Two drag corners (any order) → positive rectangle. */
export function rectFromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): PageRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/**
 * Keeps a selection on the page. Moving keeps the size; resizing past an edge trims
 * the overflow. The result is never smaller than `MIN_REGION_PT`.
 */
export function clampRegionToPage(
  rect: PageRect,
  box: PageBox,
  mode: 'move' | 'resize' = 'resize',
): PageRect {
  if (box.width <= 0 || box.height <= 0) {
    return rect
  }
  if (mode === 'move') {
    const width = Math.min(Math.max(rect.width, MIN_REGION_PT), box.width)
    const height = Math.min(Math.max(rect.height, MIN_REGION_PT), box.height)
    return {
      x: Math.min(Math.max(rect.x, box.x), box.x + box.width - width),
      y: Math.min(Math.max(rect.y, box.y), box.y + box.height - height),
      width,
      height,
    }
  }
  const x0 = Math.min(Math.max(rect.x, box.x), box.x + box.width - MIN_REGION_PT)
  const y0 = Math.min(Math.max(rect.y, box.y), box.y + box.height - MIN_REGION_PT)
  const x1 = Math.max(Math.min(rect.x + rect.width, box.x + box.width), x0 + MIN_REGION_PT)
  const y1 = Math.max(Math.min(rect.y + rect.height, box.y + box.height), y0 + MIN_REGION_PT)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export interface RegionDimensions {
  /** As the user sees it (after /Rotate), in points. */
  readonly widthPt: number
  readonly heightPt: number
  readonly widthMm: number
  readonly heightMm: number
  /** Share of the page area (0–1). */
  readonly pageShare: number
}

const MM_PER_PT = 25.4 / 72

export function regionDimensions(
  bounds: PageRect,
  box: PageBox,
  rotation: QuarterTurn,
): RegionDimensions {
  const swapped = rotation === 90 || rotation === 270
  const widthPt = swapped ? bounds.height : bounds.width
  const heightPt = swapped ? bounds.width : bounds.height
  return {
    widthPt,
    heightPt,
    widthMm: widthPt * MM_PER_PT,
    heightMm: heightPt * MM_PER_PT,
    pageShare: box.width > 0 && box.height > 0 ? (bounds.width * bounds.height) / (box.width * box.height) : 0,
  }
}

export function formatRegionSize(dimensions: RegionDimensions): string {
  const pt = `${Math.round(dimensions.widthPt)} × ${Math.round(dimensions.heightPt)} pt`
  const mm = `${dimensions.widthMm.toFixed(1)} × ${dimensions.heightMm.toFixed(1)} mm`
  return `${pt} (${mm})`
}

interface TextItemLike {
  readonly text: string
  readonly bounds: PageRect
}

function overlapShare(item: PageRect, region: PageRect): number {
  const width = Math.min(item.x + item.width, region.x + region.width) - Math.max(item.x, region.x)
  const height = Math.min(item.y + item.height, region.y + region.height) - Math.max(item.y, region.y)
  const area = item.width * item.height
  return width > 0 && height > 0 && area > 0 ? (width * height) / area : 0
}

/**
 * Text items at least half inside the region, in reading order of the displayed page.
 * `toDisplay` maps PDF rects to on-screen boxes so rotated pages read correctly.
 */
export function textInsideRegion<T extends TextItemLike>(
  items: readonly T[],
  region: PageRect,
  toDisplay: (rect: PageRect) => PageRect,
): { items: T[]; text: string } {
  const inside = items
    .filter((item) => item.text.trim() && overlapShare(item.bounds, region) >= 0.5)
    .map((item) => ({ item, box: toDisplay(item.bounds) }))
    .sort((a, b) => {
      const lineTolerance = Math.max(2, Math.min(a.box.height, b.box.height) * 0.5)
      const dy = a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2)
      return Math.abs(dy) > lineTolerance ? dy : a.box.x - b.box.x
    })
  const lines: string[] = []
  let lastCenter: number | null = null
  let lastHeight = 0
  for (const { item, box } of inside) {
    const center = box.y + box.height / 2
    if (lastCenter === null || Math.abs(center - lastCenter) > Math.max(2, Math.min(box.height, lastHeight) * 0.5)) {
      lines.push(item.text.trim())
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${item.text.trim()}`
    }
    lastCenter = center
    lastHeight = box.height
  }
  return { items: inside.map((entry) => entry.item), text: lines.join('\n') }
}
