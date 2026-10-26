import type { PageRect } from '@/types'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { TextOverlayObject } from '@/types/textOverlay'
import { normalizeHexForColorInput } from './colorUtils'

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

function localY(union: PageRect, rect: PageRect): number {
  return union.y + union.height - (rect.y + rect.height)
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

/** Rasterizes mask fills + text so exported PDFs do not expose new selectable text layers. */
export async function rasterizeTextOverlayPatch(
  text: TextOverlayObject,
  masks: readonly MaskOverlayObject[],
  union: PageRect,
  pixelsPerPoint = DEFAULT_PIXELS_PER_POINT,
): Promise<Uint8Array | null> {
  if (!canRasterizeOverlaysInThisEnvironment()) {
    return null
  }

  const widthPx = Math.max(1, Math.ceil(union.width * pixelsPerPoint))
  const heightPx = Math.max(1, Math.ceil(union.height * pixelsPerPoint))
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.scale(pixelsPerPoint, pixelsPerPoint)
  ctx.clearRect(0, 0, union.width, union.height)

  for (const mask of masks) {
    const { r, g, b } = parseHexRgb(mask.fillColor)
    ctx.globalAlpha = mask.opacity
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(
      mask.bounds.x - union.x,
      localY(union, mask.bounds),
      mask.bounds.width,
      mask.bounds.height,
    )
  }

  ctx.globalAlpha = 1

  if (text.backgroundColor) {
    const { r, g, b } = parseHexRgb(text.backgroundColor)
    ctx.globalAlpha = text.backgroundOpacity ?? 1
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(
      text.bounds.x - union.x,
      localY(union, text.bounds),
      text.bounds.width,
      text.bounds.height,
    )
    ctx.globalAlpha = 1
  }

  const { r, g, b } = parseHexRgb(text.color)
  const fontWeight = text.fontWeight === 'bold' ? 'bold' : 'normal'
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.font = `${fontWeight} ${text.fontSize}px ${text.fontFamily}, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = text.alignment

  const localTextX =
    text.alignment === 'center'
      ? text.bounds.x - union.x + text.bounds.width / 2
      : text.alignment === 'right'
        ? text.bounds.x - union.x + text.bounds.width
        : text.bounds.x - union.x
  const localTextY = localY(union, text.bounds)
  const lines = text.content.split('\n')
  const lineHeight = text.fontSize * 1.25
  for (let index = 0; index < lines.length; index += 1) {
    ctx.fillText(lines[index] ?? '', localTextX, localTextY + index * lineHeight)
  }

  return new Promise((resolve) => {
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
}
