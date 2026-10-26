import type { PageRect } from '@/types'

/** Approximates horizontal substring geometry within a PDF text item (LTR). */
export function computeSubstringMatchBounds(
  itemBounds: PageRect,
  fullText: string,
  startIndex: number,
  endIndex: number,
): PageRect {
  const length = Math.max(fullText.length, 1)
  const safeStart = Math.max(0, Math.min(startIndex, length))
  const safeEnd = Math.max(safeStart, Math.min(endIndex, length))
  const startFraction = safeStart / length
  const endFraction = safeEnd / length
  const span = Math.max(endFraction - startFraction, 1 / length)
  const width = Math.max(itemBounds.width * span, 4)
  return {
    x: itemBounds.x + itemBounds.width * startFraction,
    y: itemBounds.y,
    width,
    height: itemBounds.height,
  }
}
