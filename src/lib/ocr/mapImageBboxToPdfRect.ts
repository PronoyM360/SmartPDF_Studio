import { screenRectToPdfRect, type PageDisplayTransform } from '@/lib/pdf'
import type { PageRect } from '@/types'

interface ImageBbox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function imageBboxToPdfRect(
  transform: PageDisplayTransform,
  bbox: ImageBbox,
  offset: { x: number; y: number },
): PageRect {
  const screenRect: PageRect = {
    x: bbox.x0 + offset.x,
    y: bbox.y0 + offset.y,
    width: Math.max(bbox.x1 - bbox.x0, 1),
    height: Math.max(bbox.y1 - bbox.y0, 1),
  }
  return screenRectToPdfRect(transform, screenRect)
}
