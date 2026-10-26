export interface PixelDiffResult {
  diffSampleCount: number
  totalSamples: number
  ratio: number
  hasMeaningfulDiff: boolean
  heatmap: ImageData | null
  width: number
  height: number
}

export interface PixelDiffOptions {
  maxWidth?: number
  threshold?: number
}

function downscaleCanvas(
  source: HTMLCanvasElement,
  targetWidth: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const scale = targetWidth / Math.max(source.width, 1)
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { canvas: source, width: source.width, height: source.height }
  }
  ctx.drawImage(source, 0, 0, width, height)
  return { canvas, width, height }
}

/**
 * Compares two canvases at reduced resolution. Pixel differences indicate
 * visual mismatch only—not proof of semantic document content change.
 */
export function computeCanvasPixelDiff(
  baseCanvas: HTMLCanvasElement,
  compareCanvas: HTMLCanvasElement,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  const maxWidth = options.maxWidth ?? 640
  const threshold = options.threshold ?? 18

  const base = downscaleCanvas(baseCanvas, maxWidth)
  const compare = downscaleCanvas(compareCanvas, maxWidth)

  const width = Math.min(base.width, compare.width)
  const height = Math.min(base.height, compare.height)
  if (width <= 0 || height <= 0) {
    return {
      diffSampleCount: 0,
      totalSamples: 0,
      ratio: 0,
      hasMeaningfulDiff: false,
      heatmap: null,
      width: 0,
      height: 0,
    }
  }

  const baseCtx = base.canvas.getContext('2d', { willReadFrequently: true })
  const compareCtx = compare.canvas.getContext('2d', { willReadFrequently: true })
  if (!baseCtx || !compareCtx) {
    return {
      diffSampleCount: 0,
      totalSamples: 0,
      ratio: 0,
      hasMeaningfulDiff: false,
      heatmap: null,
      width: 0,
      height: 0,
    }
  }

  const baseData = baseCtx.getImageData(0, 0, width, height)
  const compareData = compareCtx.getImageData(0, 0, width, height)
  const heatmap = baseCtx.createImageData(width, height)

  let diffSampleCount = 0
  const totalSamples = width * height

  for (let i = 0; i < baseData.data.length; i += 4) {
    const dr = Math.abs(baseData.data[i]! - compareData.data[i]!)
    const dg = Math.abs(baseData.data[i + 1]! - compareData.data[i + 1]!)
    const db = Math.abs(baseData.data[i + 2]! - compareData.data[i + 2]!)
    const delta = (dr + dg + db) / 3
    if (delta > threshold) {
      diffSampleCount += 1
      heatmap.data[i] = 244
      heatmap.data[i + 1] = 63
      heatmap.data[i + 2] = 94
      heatmap.data[i + 3] = 72
    } else {
      heatmap.data[i + 3] = 0
    }
  }

  const ratio = totalSamples > 0 ? diffSampleCount / totalSamples : 0
  const hasMeaningfulDiff = ratio > 0.001

  return {
    diffSampleCount,
    totalSamples,
    ratio,
    hasMeaningfulDiff,
    heatmap: hasMeaningfulDiff ? heatmap : null,
    width,
    height,
  }
}
