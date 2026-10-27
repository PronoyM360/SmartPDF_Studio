import type { PageRect } from '@/types'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { TextOverlayObject } from '@/types/textOverlay'
import { normalizeHexForColorInput } from './colorUtils'
import { resolveOverlayFont } from './overlayFontResolution'
import { displaySize, userRectToDisplayLocal, type QuarterTurn } from './rotationFrame'
import { konvaFirstBaselineOffset } from './textOverlayLayout'

const DEFAULT_PIXELS_PER_POINT = 2

function unionRects(a: PageRect, b: PageRect): PageRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const top = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: top - y }
}

export function computeTextExportPatchBounds(
  text: TextOverlayObject,
  masks: readonly MaskOverlayObject[],
): PageRect {
  let bounds = text.bounds
  for (const mask of masks) {
    bounds = unionRects(bounds, mask.bounds)
  }
  return bounds
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexForColorInput(hex, '#000000').slice(1)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

export function canRasterizeOverlaysInThisEnvironment(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
}

/**
 * Rasterizes mask fills + text so exported PDFs do not expose new selectable text layers.
 * The image is drawn in page display orientation (after /Rotate), like the editor shows it.
 */
export async function rasterizeTextOverlayPatch(
  text: TextOverlayObject,
  masks: readonly MaskOverlayObject[],
  union: PageRect,
  pixelsPerPoint = DEFAULT_PIXELS_PER_POINT,
  rotation: QuarterTurn = 0,
): Promise<Uint8Array | null> {
  if (!canRasterizeOverlaysInThisEnvironment()) {
    return null
  }

  const display = displaySize(union.width, union.height, rotation)
  const widthPx = Math.max(1, Math.ceil(display.width * pixelsPerPoint))
  const heightPx = Math.max(1, Math.ceil(display.height * pixelsPerPoint))
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  try {
    ctx.scale(pixelsPerPoint, pixelsPerPoint)
    ctx.clearRect(0, 0, display.width, display.height)

    for (const mask of masks) {
      const { r, g, b } = parseHexRgb(mask.fillColor)
      const rect = userRectToDisplayLocal(mask.bounds, union, rotation)
      ctx.globalAlpha = mask.opacity
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }

    ctx.globalAlpha = 1

    const box = userRectToDisplayLocal(text.bounds, union, rotation)
    if (text.backgroundColor) {
      const { r, g, b } = parseHexRgb(text.backgroundColor)
      ctx.globalAlpha = text.backgroundOpacity ?? 1
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(box.x, box.y, box.width, box.height)
      ctx.globalAlpha = 1
    }

    const { r, g, b } = parseHexRgb(text.color)
    const font = resolveOverlayFont(text)
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.font = `${font.weight} ${text.fontSize}px ${font.family}, sans-serif`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'

    const firstBaseline = box.y + konvaFirstBaselineOffset(ctx, text.fontSize)
    const spacing = text.letterSpacing ?? 0
    const lines = text.content.split('\n')
    const lineHeight = text.fontSize * 1.25
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const chars = [...line]
      // Same as Konva: with letter spacing, glyphs are placed one by one and the line
      // width counts one spacing per character.
      const widths = spacing ? chars.map((char) => ctx.measureText(char).width) : []
      const lineWidth = ctx.measureText(line).width + spacing * chars.length
      let x = box.x
      if (text.alignment === 'center') {
        x = box.x + (box.width - lineWidth) / 2
      } else if (text.alignment === 'right') {
        x = box.x + box.width - lineWidth
      }
      const y = firstBaseline + index * lineHeight
      if (!spacing) {
        ctx.fillText(line, x, y)
        continue
      }
      chars.forEach((char, charIndex) => {
        ctx.fillText(char, x, y)
        x += (widths[charIndex] ?? 0) + spacing
      })
    }

    return await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null)
            return
          }
          void blob.arrayBuffer().then((buffer) => {
            resolve(new Uint8Array(buffer))
          })
        },
        'image/png',
        1,
      )
    })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
