import type { PageRect, PagePoint } from '@/types'
import { canvasFont } from './canvasTextMetrics'

export interface FontTrial {
  /** CSS font-family list. */
  readonly family: string
  readonly weight: 'normal' | 'bold'
  readonly italic: boolean
  readonly label: string
  /** The PDF's own embedded font program, as loaded by PDF.js. */
  readonly embedded: boolean
}

export interface FontTrialScore extends FontTrial {
  /** Intersection-over-union of glyph pixels against the rendered page (0–1). */
  readonly similarity: number
  /** Re-rendered width ÷ printed width. */
  readonly widthRatio: number
}

export interface FontVerificationResult {
  readonly scores: readonly FontTrialScore[]
  readonly skippedReason: string | null
}

function findPageCanvas(pageNumber: number): HTMLCanvasElement | null {
  const canvas = document.querySelector(`canvas[aria-label="PDF page ${pageNumber}"]`)
  return canvas instanceof HTMLCanvasElement ? canvas : null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 255
}

/**
 * Re-renders the original value in each candidate font at the PDF position and size,
 * and compares glyph pixels with the page as PDF.js drew it. This is the evidence
 * behind every font-match claim; nothing is called exact without it.
 */
export function verifyFontTrials(input: {
  pageNumber: number
  pageWidthPt: number
  pageHeightPt: number
  text: string
  bounds: PageRect
  baseline: PagePoint
  fontSizePt: number
  trials: readonly FontTrial[]
}): FontVerificationResult {
  if (typeof document === 'undefined') {
    return { scores: [], skippedReason: 'Font verification needs a browser.' }
  }
  const canvas = findPageCanvas(input.pageNumber)
  if (!canvas) {
    return { scores: [], skippedReason: 'The page is not rendered on screen, so the font could not be checked.' }
  }
  const scale = canvas.width / input.pageWidthPt
  if (Math.abs(canvas.height / input.pageHeightPt - scale) / scale > 0.03) {
    return { scores: [], skippedReason: 'Font check is not available on rotated pages.' }
  }
  const pageCtx = canvas.getContext('2d', { willReadFrequently: true })
  if (!pageCtx) {
    return { scores: [], skippedReason: 'Could not read the rendered page.' }
  }

  const size = input.fontSizePt * scale
  const margin = Math.max(3, size * 0.2)
  const baselinePx = (input.pageHeightPt - input.baseline.y) * scale
  const left = Math.max(0, Math.floor(input.bounds.x * scale - margin))
  const right = Math.min(canvas.width, Math.ceil((input.bounds.x + input.bounds.width) * scale + margin))
  const top = Math.max(0, Math.floor(baselinePx - size * 0.95))
  const bottom = Math.min(canvas.height, Math.ceil(baselinePx + size * 0.28))
  const width = right - left
  const height = bottom - top
  if (width < 4 || height < 4) {
    return { scores: [], skippedReason: 'The value is too small on screen to check the font. Zoom in and reopen.' }
  }

  let page: ImageData
  try {
    page = pageCtx.getImageData(left, top, width, height)
  } catch {
    return { scores: [], skippedReason: 'Reading page pixels was blocked.' }
  }
  const border: number[][] = []
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      const o = (y * width + x) * 4
      border.push([page.data[o]!, page.data[o + 1]!, page.data[o + 2]!])
    }
  }
  const bg = [0, 1, 2].map((channel) => median(border.map((pixel) => pixel[channel]!)))
  const pageInk = new Uint8Array(width * height)
  let inkCount = 0
  for (let index = 0; index < width * height; index += 1) {
    const o = index * 4
    const distance = Math.hypot(page.data[o]! - bg[0]!, page.data[o + 1]! - bg[1]!, page.data[o + 2]! - bg[2]!)
    if (distance > 80) {
      pageInk[index] = 1
      inkCount += 1
    }
  }
  if (inkCount < 6) {
    return { scores: [], skippedReason: 'No printed glyphs were found at the expected position.' }
  }

  const probe = document.createElement('canvas')
  probe.width = width
  probe.height = height
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })
  if (!probeCtx) {
    return { scores: [], skippedReason: 'Could not create a drawing surface.' }
  }

  const originX = input.bounds.x * scale - left
  const originY = baselinePx - top
  const shiftX = Math.max(2, Math.round(size * 0.12))
  const shiftY = Math.max(1, Math.round(size * 0.06))
  const scores: FontTrialScore[] = []
  for (const trial of input.trials) {
    probeCtx.clearRect(0, 0, width, height)
    probeCtx.fillStyle = '#ffffff'
    probeCtx.fillRect(0, 0, width, height)
    probeCtx.fillStyle = '#000000'
    probeCtx.font = canvasFont(trial.family, trial.weight, size, trial.italic)
    probeCtx.textBaseline = 'alphabetic'
    probeCtx.fillText(input.text, originX, originY)
    const drawn = probeCtx.getImageData(0, 0, width, height).data
    const trialInk = new Uint8Array(width * height)
    for (let index = 0; index < width * height; index += 1) {
      trialInk[index] = drawn[index * 4]! < 128 ? 1 : 0
    }
    let best = 0
    for (let dy = -shiftY; dy <= shiftY; dy += 1) {
      for (let dx = -shiftX; dx <= shiftX; dx += 1) {
        let intersection = 0
        let union = 0
        for (let y = 0; y < height; y += 1) {
          const sy = y - dy
          for (let x = 0; x < width; x += 1) {
            const sx = x - dx
            const a = pageInk[y * width + x]!
            const b = sx >= 0 && sx < width && sy >= 0 && sy < height ? trialInk[sy * width + sx]! : 0
            if (a || b) {
              union += 1
              if (a && b) {
                intersection += 1
              }
            }
          }
        }
        best = Math.max(best, union > 0 ? intersection / union : 0)
      }
    }
    const measured = probeCtx.measureText(input.text).width
    scores.push({
      ...trial,
      similarity: best,
      widthRatio: input.bounds.width > 0 ? measured / (input.bounds.width * scale) : 1,
    })
  }
  scores.sort((a, b) => b.similarity - a.similarity)
  return { scores, skippedReason: null }
}
