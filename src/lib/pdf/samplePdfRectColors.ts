import type { PageRect } from '@/types'

export type BackgroundKind = 'solid' | 'complex' | 'unknown'

export interface PdfRectColorSample {
  readonly backgroundColor: string | null
  readonly textColor: string | null
  readonly backgroundKind: BackgroundKind
  readonly notes: readonly string[]
}

function findPageCanvas(pageNumber: number): HTMLCanvasElement | null {
  const canvas = document.querySelector(
    `canvas[aria-label="PDF page ${pageNumber}"]`,
  )
  return canvas instanceof HTMLCanvasElement ? canvas : null
}

function pdfRectToCanvasRect(
  canvas: HTMLCanvasElement,
  pageWidthPt: number,
  pageHeightPt: number,
  bounds: PageRect,
): { x: number; y: number; width: number; height: number } | null {
  if (pageWidthPt <= 0 || pageHeightPt <= 0) {
    return null
  }
  const x = (bounds.x / pageWidthPt) * canvas.width
  const width = (bounds.width / pageWidthPt) * canvas.width
  const height = (bounds.height / pageHeightPt) * canvas.height
  const y =
    ((pageHeightPt - bounds.y - bounds.height) / pageHeightPt) * canvas.height
  if (width < 1 || height < 1) {
    return null
  }
  return { x, y, width, height }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function averageColor(data: Uint8ClampedArray): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  const pixels = data.length / 4
  if (pixels <= 0) {
    return [255, 255, 255]
  }
  for (let i = 0; i < data.length; i += 4) {
    r += data[i] ?? 0
    g += data[i + 1] ?? 0
    b += data[i + 2] ?? 0
  }
  return [r / pixels, g / pixels, b / pixels]
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Samples colors from the rendered PDF canvas for a PDF-space rectangle.
 * Requires the page to be visible in the editor canvas.
 */
export function samplePdfRectColors(
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number,
  bounds: PageRect,
): PdfRectColorSample {
  const notes: string[] = []
  const canvas = findPageCanvas(pageNumber)
  if (!canvas) {
    return {
      backgroundColor: null,
      textColor: null,
      backgroundKind: 'unknown',
      notes: ['Page preview is not rendered — color sampling skipped.'],
    }
  }

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return {
      backgroundColor: null,
      textColor: null,
      backgroundKind: 'unknown',
      notes: ['Could not read canvas pixels.'],
    }
  }

  const rect = pdfRectToCanvasRect(canvas, pageWidthPt, pageHeightPt, bounds)
  if (!rect) {
    return {
      backgroundColor: null,
      textColor: null,
      backgroundKind: 'unknown',
      notes: ['Text region is too small to sample.'],
    }
  }

  const pad = Math.max(2, Math.floor(Math.min(rect.width, rect.height) * 0.15))
  const outer = {
    x: Math.max(0, Math.floor(rect.x - pad)),
    y: Math.max(0, Math.floor(rect.y - pad)),
    width: Math.min(canvas.width - rect.x + pad, Math.ceil(rect.width + pad * 2)),
    height: Math.min(canvas.height - rect.y + pad, Math.ceil(rect.height + pad * 2)),
  }

  try {
    const innerX = Math.floor(rect.x + rect.width * 0.25)
    const innerY = Math.floor(rect.y + rect.height * 0.25)
    const innerW = Math.max(1, Math.floor(rect.width * 0.5))
    const innerH = Math.max(1, Math.floor(rect.height * 0.5))

    const outerData = context.getImageData(outer.x, outer.y, outer.width, outer.height)
    const innerData = context.getImageData(innerX, innerY, innerW, innerH)

    const outerAvg = averageColor(outerData.data)
    const innerAvg = averageColor(innerData.data)

    const cornerSamples: [number, number, number][] = []
    const corners = [
      [outer.x, outer.y],
      [outer.x + outer.width - 1, outer.y],
      [outer.x, outer.y + outer.height - 1],
      [outer.x + outer.width - 1, outer.y + outer.height - 1],
    ] as const
    for (const [cx, cy] of corners) {
      const pixel = context.getImageData(cx, cy, 1, 1).data
      cornerSamples.push([pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0])
    }

    const cornerSpread = Math.max(
      ...cornerSamples.map((sample) => colorDistance(sample, outerAvg)),
    )
    const backgroundKind: BackgroundKind =
      cornerSpread < 28 ? 'solid' : cornerSpread < 55 ? 'complex' : 'complex'

    if (backgroundKind === 'complex') {
      notes.push(
        'Background varies across the cover region; a flat mask may not match perfectly.',
      )
    }

    const backgroundColor = rgbToHex(outerAvg[0], outerAvg[1], outerAvg[2])
    const textColor =
      colorDistance(innerAvg, outerAvg) > 18
        ? rgbToHex(innerAvg[0], innerAvg[1], innerAvg[2])
        : null

    if (!textColor) {
      notes.push(
        'Could not isolate text color from the preview; verify color after applying.',
      )
    }

    return { backgroundColor, textColor, backgroundKind, notes }
  } catch {
    return {
      backgroundColor: null,
      textColor: null,
      backgroundKind: 'unknown',
      notes: ['Canvas pixel read blocked — use visual verification.'],
    }
  }
}
