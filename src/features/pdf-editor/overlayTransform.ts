import type Konva from 'konva'
import { clampPageRect, type PageSizePt } from '@/lib/pdf/clampPageRect'
import { screenRectToPdfRect } from '@/lib/pdf'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { PageRect } from '@/types'

export function commitGroupBounds(
  node: Konva.Group,
  transform: PageDisplayTransform,
  boxName: string,
  minWidth = 16,
  minHeight = 16,
  pageSize?: PageSizePt | null,
): PageRect {
  const boxNode = node.findOne(`.${boxName}`)
  const width = Math.max(
    minWidth,
    boxNode ? boxNode.width() * node.scaleX() : node.width(),
  )
  const height = Math.max(
    minHeight,
    boxNode ? boxNode.height() * node.scaleY() : node.height(),
  )
  node.scaleX(1)
  node.scaleY(1)
  if (boxNode) {
    boxNode.width(width)
    boxNode.height(height)
  }

  const pdfBounds = screenRectToPdfRect(transform, {
    x: node.x(),
    y: node.y(),
    width,
    height,
  })
  return pageSize ? clampPageRect(pdfBounds, pageSize) : pdfBounds
}
