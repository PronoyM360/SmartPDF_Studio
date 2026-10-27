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

function medianColor(pixels: readonly [number, number, number][]): [number, number, number] {
  const channel = (index: 0 | 1 | 2): number => {
    const values = pixels.map((pixel) => pixel[index]).sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)] ?? 255
  }
  return [channel(0), channel(1), channel(2)]
}

function meanColor(pixels: readonly [number, number, number][]): [number, number, number] {
  const sum = pixels.reduce<[number, number, number]>(
    (acc, pixel) => [acc[0] + pixel[0], acc[1] + pixel[1], acc[2] + pixel[2]],
    [0, 0, 0],
  )
  return [sum[0] / pixels.length, sum[1] / pixels.length, sum[2] / pixels.length]
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
    width: Math.min(canvas.width - Math.max(0, Math.floor(rect.x - pad)), Math.ceil(rect.width + pad * 2)),
    height: Math.min(canvas.height - Math.max(0, Math.floor(rect.y - pad)), Math.ceil(rect.height + pad * 2)),
  }

  try {
    const outerData = context.getImageData(outer.x, outer.y, outer.width, outer.height)
    // Ring = padding around the text box; it shows the background without glyphs.
    const ring: [number, number, number][] = []
    const inside: [number, number, number][] = []
    const left = rect.x - outer.x
    const top = rect.y - outer.y
    for (let py = 0; py < outer.height; py += 1) {
      for (let px = 0; px < outer.width; px += 1) {
        const offset = (py * outer.width + px) * 4
        const pixel: [number, number, number] = [
          outerData.data[offset] ?? 0,
          outerData.data[offset + 1] ?? 0,
          outerData.data[offset + 2] ?? 0,
        ]
        const inRect = px >= left && px < left + rect.width && py >= top && py < top + rect.height
        ;(inRect ? inside : ring).push(pixel)
      }
    }
    const background = ring.length > 0 ? medianColor(ring) : averageColor(outerData.data)
    const ringOutliers = ring.filter((pixel) => colorDistance(pixel, background) > 30).length
    const backgroundKind: BackgroundKind =
      ring.length > 0 && ringOutliers / ring.length <= 0.08 ? 'solid' : 'complex'

    if (backgroundKind === 'complex') {
      notes.push(
        'Background varies across the cover region; a flat mask may not match perfectly.',
      )
    }

    const backgroundColor = rgbToHex(background[0], background[1], background[2])
    // Anti-aliased glyph edges blend with the background; the most distinct pixels
    // are closest to the real ink colour.
    const ranked = inside
      .map((pixel) => ({ pixel, distance: colorDistance(pixel, background) }))
      .filter((entry) => entry.distance > 18)
      .sort((a, b) => b.distance - a.distance)
    const core = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.2)))
    const ink = core.length > 0 && ranked.length >= 3 ? meanColor(core.map((entry) => entry.pixel)) : null
    const textColor = ink ? rgbToHex(ink[0], ink[1], ink[2]) : null

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
