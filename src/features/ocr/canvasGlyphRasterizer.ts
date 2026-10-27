import type { BinaryMask, GlyphRasterizer } from '@/lib/ocr/fontShapeMatch'

/**
 * Canvas text → binary mask. `coverage` is the alpha share counted as ink, chosen to
 * match how strictly the scan's ink pixels were picked.
 */
export function createCanvasGlyphRasterizer(coverage: number): GlyphRasterizer {
  const threshold = Math.round(Math.min(0.9, Math.max(0.05, coverage)) * 255)
  return (text, family, weight, sizePx): BinaryMask | null => {
    if (typeof document === 'undefined' || sizePx <= 0) {
      return null
    }
    const canvas = document.createElement('canvas')
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        return null
      }
      const font = `${weight} ${sizePx}px ${family}, sans-serif`
      ctx.font = font
      canvas.width = Math.max(1, Math.ceil(ctx.measureText(text).width + sizePx))
      canvas.height = Math.max(1, Math.ceil(sizePx * 1.6))
      ctx.font = font
      ctx.fillStyle = '#000'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(text, sizePx * 0.4, sizePx * 1.2)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const mask = new Uint8Array(width * height)
      for (let index = 0; index < mask.length; index += 1) {
        mask[index] = (data[index * 4 + 3] ?? 0) >= threshold ? 1 : 0
      }
      return { data: mask, width, height }
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
