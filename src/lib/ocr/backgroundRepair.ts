import type { BackgroundRepairMethod, RegionBackgroundKind } from '@/types/backgroundRepair'

export interface RgbaImage {
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number
}

/** Integer pixel rectangle, top-left origin. */
export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type Rgb = [number, number, number]

/** value = c0 + cx * x + cy * y, per channel, in image pixel coordinates. */
interface Plane {
  readonly c0: number
  readonly cx: number
  readonly cy: number
}

export interface RegionBackgroundAnalysis {
  readonly kind: RegionBackgroundKind
  readonly backgroundColor: string
  readonly inkColor: string | null
  readonly planes: readonly [Plane, Plane, Plane]
  /** RMS deviation of background pixels around the text from the fitted plane. */
  readonly residualStd: number
  /** Per-channel RMS grain of the clean background right next to the text. */
  readonly localNoise: number
  /** Share of surrounding pixels that are not background (other text, logos, edges). */
  readonly ringOutlierRatio: number
  readonly edgeDensity: number
  /** Colour change across the region predicted by the plane fit (0–441). */
  readonly gradientSpan: number
  readonly crossingLineRows: readonly number[]
  readonly crossingLineColumns: readonly number[]
  /**
   * Background guessed for every pixel from the nearest surroundings above, below, left
   * and right of the text (RGB triplets, width × height × 3).
   */
  readonly localEstimate: Float32Array
  /** 1 where an old glyph pixel must be rebuilt (dilated); length = width × height. */
  readonly repairMask: Uint8Array
  /**
   * Glyph shape binarized halfway between background and ink colour, so blur and JPEG
   * fringes do not fatten it — the shape used for font matching.
   */
  readonly inkMask: Uint8Array
  readonly repairPixelCount: number
  /** Share of the text box covered by clearly visible ink. */
  readonly inkCoverage: number
  /** Median horizontal ink run in pixels — a rough stroke width. */
  readonly strokeWidthPx: number | null
  readonly warnings: readonly string[]
}

export interface BackgroundRepairResult {
  /** RGBA, same size as the analysed image; alpha 0 wherever the original is kept. */
  readonly pixels: Uint8ClampedArray
  readonly width: number
  readonly height: number
  /** Bounding box of rebuilt pixels, or null when nothing needed repair. */
  readonly repairedBounds: PixelRect | null
  readonly method: BackgroundRepairMethod
  /**
   * Mean colour jump where rebuilt pixels meet kept pixels (0–255). A measured
   * continuity hint only — it cannot prove the result matches the lost background.
   */
  readonly seamScore: number
  readonly notes: readonly string[]
}

const OUTLIER_MIN_DISTANCE = 30
const INK_MIN_DISTANCE = 40
const HALO_MIN_DISTANCE = 22
const EDGE_LUMA_STEP = 48
const LINE_ROW_OUTLIER_SHARE = 0.7
const SOLID_MAX_OUTLIERS = 0.04
const SOLID_MAX_RESIDUAL = 10
const GRADIENT_MIN_SPAN = 10
const COMPLEX_MIN_EDGES = 0.1
const COMPLEX_MIN_OUTLIERS = 0.12
const SMOOTH_SEAM_SCORE = 12
/** Bold digits can cover ~55% of their tight box; barcodes and solid shapes cover more. */
const MOSTLY_INK_COVERAGE = 0.65

function toHex([r, g, b]: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function insideRect(x: number, y: number, rect: PixelRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

function pixel(image: RgbaImage, index: number): Rgb {
  const offset = index * 4
  return [image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0]
}

function luma(image: RgbaImage, index: number): number {
  const [r, g, b] = pixel(image, index)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function evaluate(planes: readonly [Plane, Plane, Plane], x: number, y: number): Rgb {
  return planes.map((plane) => plane.c0 + plane.cx * x + plane.cy * y) as Rgb
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Least-squares plane per channel; falls back to the mean when the fit is degenerate. */
function fitPlanes(image: RgbaImage, indices: readonly number[]): [Plane, Plane, Plane] {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  let syy = 0
  const sv = [0, 0, 0]
  const sxv = [0, 0, 0]
  const syv = [0, 0, 0]
  for (const index of indices) {
    const x = index % image.width
    const y = Math.floor(index / image.width)
    const value = pixel(image, index)
    n += 1
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
    syy += y * y
    for (let channel = 0; channel < 3; channel += 1) {
      sv[channel]! += value[channel]!
      sxv[channel]! += x * value[channel]!
      syv[channel]! += y * value[channel]!
    }
  }
  if (n === 0) {
    return [
      { c0: 255, cx: 0, cy: 0 },
      { c0: 255, cx: 0, cy: 0 },
      { c0: 255, cx: 0, cy: 0 },
    ]
  }
  // Normal equations [[n sx sy][sx sxx sxy][sy sxy syy]] · [c0 cx cy] = [sv sxv syv]
  const det =
    n * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy)
  return [0, 1, 2].map((channel) => {
    const v = sv[channel]!
    const xv = sxv[channel]!
    const yv = syv[channel]!
    if (Math.abs(det) < 1e-6 * Math.max(1, n * n * n)) {
      return { c0: v / n, cx: 0, cy: 0 }
    }
    const c0 = (v * (sxx * syy - sxy * sxy) - sx * (xv * syy - sxy * yv) + sy * (xv * sxy - sxx * yv)) / det
    const cx = (n * (xv * syy - sxy * yv) - v * (sx * syy - sxy * sy) + sy * (sx * yv - xv * sy)) / det
    const cy = (n * (sxx * yv - xv * sxy) - sx * (sx * yv - xv * sy) + v * (sx * sxy - sxx * sy)) / det
    return { c0, cx, cy }
  }) as [Plane, Plane, Plane]
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) {
    return mask
  }
  const horizontal = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) {
        continue
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx
        if (nx >= 0 && nx < width) {
          horizontal[y * width + nx] = 1
        }
      }
    }
  }
  const result = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!horizontal[y * width + x]) {
        continue
      }
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy
        if (ny >= 0 && ny < height) {
          result[ny * width + x] = 1
        }
      }
    }
  }
  return result
}

/**
 * Drops 8-connected blobs far smaller than the largest one: noise on textured
 * backgrounds forms specks, glyphs (even full stops) form solid components.
 */
function removeSpecks(
  mask: Uint8Array,
  width: number,
  height: number,
  contrast: Float32Array,
  strongContrast: number,
): Uint8Array {
  const labels = new Int32Array(mask.length)
  const sizes: number[] = [0]
  const peaks: number[] = [0]
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) {
      continue
    }
    const label = sizes.length
    let size = 0
    let peak = 0
    const stack = [start]
    labels[start] = label
    while (stack.length > 0) {
      const index = stack.pop()!
      size += 1
      peak = Math.max(peak, contrast[index] ?? 0)
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue
          }
          const neighbor = ny * width + nx
          if (mask[neighbor] && !labels[neighbor]) {
            labels[neighbor] = label
            stack.push(neighbor)
          }
        }
      }
    }
    sizes.push(size)
    peaks.push(peak)
  }
  const minSize = Math.max(2, Math.round(Math.max(...sizes) * 0.02))
  const result = new Uint8Array(mask.length)
  for (let index = 0; index < mask.length; index += 1) {
    const label = labels[index]!
    // Real glyph parts reach close to full ink contrast; texture specks barely pass.
    if (label && sizes[label]! >= minSize && peaks[label]! >= strongContrast) {
      result[index] = 1
    }
  }
  return result
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)] ?? null
}

function medianRgb(samples: readonly Rgb[]): Rgb | null {
  if (samples.length === 0) {
    return null
  }
  return [0, 1, 2].map((channel) => median(samples.map((sample) => sample[channel]!))!) as Rgb
}

/**
 * Rules are thin and have background on both sides; thick runs of "outlier" rows are
 * a different background (photo edge, coloured band), not a line.
 */
function keepThinRuns(indices: readonly number[], extent: number): number[] {
  const maxThickness = Math.max(2, Math.round(extent * 0.12))
  const sorted = [...indices].sort((a, b) => a - b)
  const kept: number[] = []
  let start = 0
  while (start < sorted.length) {
    let end = start
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) {
      end += 1
    }
    const first = sorted[start]!
    const last = sorted[end]!
    if (last - first + 1 <= maxThickness && first > 0 && last < extent - 1) {
      for (let value = first; value <= last; value += 1) {
        kept.push(value)
      }
    }
    start = end + 1
  }
  return kept
}

const PROFILE_DEPTH = 3

/**
 * Median background colour just outside each side of the text box, per column (top,
 * bottom) and per row (left, right). Outliers such as neighbouring glyphs are skipped.
 */
function sideProfiles(
  image: RgbaImage,
  textRect: PixelRect,
  isOutlier: Uint8Array,
): { top: (Rgb | null)[]; bottom: (Rgb | null)[]; left: (Rgb | null)[]; right: (Rgb | null)[] } {
  const { width, height } = image
  const collect = (coords: [number, number][]): Rgb | null => {
    const clean: Rgb[] = []
    for (const [x, y] of coords) {
      if (x >= 0 && y >= 0 && x < width && y < height && !isOutlier[y * width + x]) {
        clean.push(pixel(image, y * width + x))
      }
    }
    return medianRgb(clean)
  }
  const top: (Rgb | null)[] = []
  const bottom: (Rgb | null)[] = []
  for (let x = 0; x < width; x += 1) {
    const above: [number, number][] = []
    const below: [number, number][] = []
    for (let step = 1; step <= PROFILE_DEPTH; step += 1) {
      above.push([x, textRect.y - step])
      below.push([x, textRect.y + textRect.height - 1 + step])
    }
    top.push(collect(above))
    bottom.push(collect(below))
  }
  const left: (Rgb | null)[] = []
  const right: (Rgb | null)[] = []
  for (let y = 0; y < height; y += 1) {
    const before: [number, number][] = []
    const after: [number, number][] = []
    for (let step = 1; step <= PROFILE_DEPTH; step += 1) {
      before.push([textRect.x - step, y])
      after.push([textRect.x + textRect.width - 1 + step, y])
    }
    left.push(collect(before))
    right.push(collect(after))
  }
  return { top, bottom, left, right }
}

/**
 * Studies the pixels around and inside an OCR text box. `image` must include a margin
 * of background around `textRect` — that ring is what the background is learned from.
 */
export function analyzeRegionBackground(
  image: RgbaImage,
  textRect: PixelRect,
  options: { dilateRadius?: number } = {},
): RegionBackgroundAnalysis {
  const { width, height } = image
  const warnings: string[] = []
  const ring: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!insideRect(x, y, textRect)) {
        ring.push(y * width + x)
      }
    }
  }
  if (ring.length < 16) {
    warnings.push('Too little surrounding background to learn from — widen the region.')
  }

  // Two passes: the second ignores ring pixels that belong to other text or edges.
  let planes = fitPlanes(image, ring)
  const firstDistances = ring.map((index) =>
    distance(pixel(image, index), evaluate(planes, index % width, Math.floor(index / width))),
  )
  const firstRms = Math.sqrt(
    firstDistances.reduce((sum, value) => sum + value * value, 0) / Math.max(1, firstDistances.length),
  )
  const inlierCut = Math.max(OUTLIER_MIN_DISTANCE, firstRms * 1.5)
  const inliers = ring.filter((_, position) => (firstDistances[position] ?? 0) <= inlierCut)
  planes = fitPlanes(image, inliers.length >= 8 ? inliers : ring)

  let squared = 0
  for (const index of inliers) {
    const d = distance(pixel(image, index), evaluate(planes, index % width, Math.floor(index / width)))
    squared += (d * d) / 3
  }
  const residualStd = Math.sqrt(squared / Math.max(1, inliers.length))
  const outlierCut = Math.max(OUTLIER_MIN_DISTANCE, residualStd * 4)

  const isOutlier = new Uint8Array(width * height)
  const rowCounts = new Int32Array(height)
  const rowOutliers = new Int32Array(height)
  const columnCounts = new Int32Array(width)
  const columnOutliers = new Int32Array(width)
  for (const index of ring) {
    const x = index % width
    const y = Math.floor(index / width)
    const outlier = distance(pixel(image, index), evaluate(planes, x, y)) > outlierCut
    rowCounts[y]! += 1
    columnCounts[x]! += 1
    if (outlier) {
      isOutlier[index] = 1
      rowOutliers[y]! += 1
      columnOutliers[x]! += 1
    }
  }

  const crossingLineRows: number[] = []
  for (let y = 0; y < height; y += 1) {
    const count = rowCounts[y] ?? 0
    // Rows through the text band only have left/right margin pixels, so both must agree.
    const throughText = y >= textRect.y && y < textRect.y + textRect.height
    if (count >= 6 && (rowOutliers[y] ?? 0) / count >= LINE_ROW_OUTLIER_SHARE) {
      if (!throughText) {
        crossingLineRows.push(y)
        continue
      }
      const leftOutlier = textRect.x > 0 && isOutlier[y * width + textRect.x - 1]
      const right = textRect.x + textRect.width
      const rightOutlier = right < width && isOutlier[y * width + right]
      if (leftOutlier && rightOutlier) {
        crossingLineRows.push(y)
      }
    }
  }
  const crossingLineColumns: number[] = []
  for (let x = 0; x < width; x += 1) {
    const count = columnCounts[x] ?? 0
    const throughText = x >= textRect.x && x < textRect.x + textRect.width
    if (count >= 6 && (columnOutliers[x] ?? 0) / count >= LINE_ROW_OUTLIER_SHARE) {
      if (!throughText) {
        crossingLineColumns.push(x)
        continue
      }
      const topOutlier = textRect.y > 0 && isOutlier[(textRect.y - 1) * width + x]
      const bottom = textRect.y + textRect.height
      const bottomOutlier = bottom < height && isOutlier[bottom * width + x]
      if (topOutlier && bottomOutlier) {
        crossingLineColumns.push(x)
      }
    }
  }
  const lineRowSet = new Set(keepThinRuns(crossingLineRows, height))
  const lineColumnSet = new Set(keepThinRuns(crossingLineColumns, width))
  crossingLineRows.splice(0, crossingLineRows.length, ...lineRowSet)
  crossingLineColumns.splice(0, crossingLineColumns.length, ...lineColumnSet)
  let ringOutliers = 0
  for (const index of ring) {
    if (isOutlier[index] && !lineRowSet.has(Math.floor(index / width)) && !lineColumnSet.has(index % width)) {
      ringOutliers += 1
    }
  }
  const ringOutlierRatio = ringOutliers / Math.max(1, ring.length)

  let edges = 0
  let edgeSamples = 0
  for (const index of ring) {
    const x = index % width
    const y = Math.floor(index / width)
    if (x + 1 >= width || y + 1 >= height) {
      continue
    }
    const here = luma(image, index)
    const step = Math.abs(luma(image, index + 1) - here) + Math.abs(luma(image, index + width) - here)
    edgeSamples += 1
    if (step > EDGE_LUMA_STEP) {
      edges += 1
    }
  }
  const edgeDensity = edges / Math.max(1, edgeSamples)

  const corners = [
    evaluate(planes, 0, 0),
    evaluate(planes, width - 1, 0),
    evaluate(planes, 0, height - 1),
    evaluate(planes, width - 1, height - 1),
  ]
  const centre = evaluate(planes, textRect.x + textRect.width / 2, textRect.y + textRect.height / 2)
  const gradientSpan = Math.max(...corners.map((corner) => distance(corner, centre))) * 2
  const hasLines = crossingLineRows.length + crossingLineColumns.length > 0

  let kind: RegionBackgroundKind
  if (ringOutlierRatio <= SOLID_MAX_OUTLIERS && residualStd <= SOLID_MAX_RESIDUAL) {
    kind = hasLines ? 'lines' : gradientSpan > GRADIENT_MIN_SPAN ? 'gradient' : 'solid'
  } else if (edgeDensity > COMPLEX_MIN_EDGES || ringOutlierRatio > COMPLEX_MIN_OUTLIERS) {
    kind = 'complex'
  } else {
    kind = 'textured'
  }

  // Background under the text, interpolated from the nearest clean pixels on each side.
  // Unlike the plane, this follows local changes such as photo edges.
  const profiles = sideProfiles(image, textRect, isOutlier)
  const localEstimate = new Float32Array(width * height * 3)
  for (let index = 0; index < width * height; index += 1) {
    const value = pixel(image, index)
    localEstimate[index * 3] = value[0]
    localEstimate[index * 3 + 1] = value[1]
    localEstimate[index * 3 + 2] = value[2]
  }
  let noiseSquared = 0
  let noiseCount = 0
  const addNoise = (x: number, y: number, reference: Rgb | null | undefined): void => {
    if (!reference || x < 0 || y < 0 || x >= width || y >= height || isOutlier[y * width + x]) {
      return
    }
    const d = distance(pixel(image, y * width + x), reference)
    noiseSquared += (d * d) / 3
    noiseCount += 1
  }
  for (let step = 1; step <= PROFILE_DEPTH; step += 1) {
    for (let x = textRect.x; x < textRect.x + textRect.width; x += 1) {
      addNoise(x, textRect.y - step, profiles.top[x])
      addNoise(x, textRect.y + textRect.height - 1 + step, profiles.bottom[x])
    }
    for (let y = textRect.y; y < textRect.y + textRect.height; y += 1) {
      addNoise(textRect.x - step, y, profiles.left[y])
      addNoise(textRect.x + textRect.width - 1 + step, y, profiles.right[y])
    }
  }
  const localNoise = noiseCount > 0 ? Math.sqrt(noiseSquared / noiseCount) : residualStd

  // Glyph pixels: anything inside the (slightly grown) text box that stands out from the
  // local background. Crossing rules are kept so table lines are not erased.
  const radius = Math.max(0, Math.round(options.dilateRadius ?? 1))
  const search: PixelRect = {
    x: Math.max(0, textRect.x - radius),
    y: Math.max(0, textRect.y - radius),
    width: Math.min(width, textRect.x + textRect.width + radius) - Math.max(0, textRect.x - radius),
    height: Math.min(height, textRect.y + textRect.height + radius) - Math.max(0, textRect.y - radius),
  }
  const inkCut = Math.max(INK_MIN_DISTANCE, localNoise * 4)
  const haloCut = Math.max(HALO_MIN_DISTANCE, localNoise * 2.5)
  const core = new Uint8Array(width * height)
  const halo = new Uint8Array(width * height)
  const contrast = new Float32Array(width * height)
  const inkSamples: { value: Rgb; distance: number }[] = []
  let coreInText = 0
  for (let y = search.y; y < search.y + search.height; y += 1) {
    for (let x = search.x; x < search.x + search.width; x += 1) {
      const index = y * width + x
      const sides: [Rgb | null | undefined, number][] = [
        [profiles.top[x], y - textRect.y + 1],
        [profiles.bottom[x], textRect.y + textRect.height - y],
        [profiles.left[y], x - textRect.x + 1],
        [profiles.right[y], textRect.x + textRect.width - x],
      ]
      const sum: Rgb = [0, 0, 0]
      let weight = 0
      for (const [color, gap] of sides) {
        if (!color) {
          continue
        }
        const w = 1 / Math.max(0.5, gap) ** 2
        sum[0] += color[0] * w
        sum[1] += color[1] * w
        sum[2] += color[2] * w
        weight += w
      }
      const estimate: Rgb =
        weight > 0 ? [sum[0] / weight, sum[1] / weight, sum[2] / weight] : evaluate(planes, x, y)
      localEstimate[index * 3] = estimate[0]
      localEstimate[index * 3 + 1] = estimate[1]
      localEstimate[index * 3 + 2] = estimate[2]
      if (lineRowSet.has(y) || lineColumnSet.has(x)) {
        continue
      }
      const value = pixel(image, index)
      const d = distance(value, estimate)
      contrast[index] = d
      if (d > haloCut) {
        halo[index] = 1
      }
      if (d > inkCut) {
        core[index] = 1
        inkSamples.push({ value, distance: d })
      }
    }
  }
  // Noise on textured backgrounds can pass the thresholds on its own: keep only ink with
  // an inked neighbour, and only halo that touches that ink.
  const byStrength = inkSamples.map((sample) => sample.distance).sort((a, b) => b - a)
  const inkStrength = byStrength[Math.floor(byStrength.length * 0.125)] ?? inkCut
  const cleanCore = removeSpecks(core, width, height, contrast, Math.max(inkCut, inkStrength * 0.5))
  const nearInk = dilate(cleanCore, width, height, radius + 1)
  for (let index = 0; index < halo.length; index += 1) {
    halo[index] = (halo[index]! & nearInk[index]!) | cleanCore[index]!
  }
  coreInText = 0
  for (let y = textRect.y; y < textRect.y + textRect.height; y += 1) {
    for (let x = textRect.x; x < textRect.x + textRect.width; x += 1) {
      coreInText += cleanCore[y * width + x]!
    }
  }
  const repairMask = dilate(halo, width, height, radius)
  for (const y of crossingLineRows) {
    repairMask.fill(0, y * width, (y + 1) * width)
  }
  for (const x of crossingLineColumns) {
    for (let y = 0; y < height; y += 1) {
      repairMask[y * width + x] = 0
    }
  }
  let repairPixelCount = 0
  for (const value of repairMask) {
    repairPixelCount += value
  }

  const textArea = Math.max(1, textRect.width * textRect.height)
  const inkCoverage = coreInText / textArea
  inkSamples.sort((a, b) => b.distance - a.distance)
  const strongest = inkSamples.slice(0, Math.max(1, Math.ceil(inkSamples.length * 0.25)))
  const inkRgb =
    inkSamples.length >= 3
      ? (strongest
          .reduce<Rgb>((sum, entry) => [sum[0] + entry.value[0], sum[1] + entry.value[1], sum[2] + entry.value[2]], [0, 0, 0])
          .map((sum) => sum / strongest.length) as Rgb)
      : null
  const inkColor = inkRgb ? toHex(inkRgb) : null

  const shapeMask = new Uint8Array(width * height)
  if (inkRgb) {
    const nearGlyphs = dilate(cleanCore, width, height, 1)
    for (let y = search.y; y < search.y + search.height; y += 1) {
      for (let x = search.x; x < search.x + search.width; x += 1) {
        const index = y * width + x
        if (!nearGlyphs[index]) {
          continue
        }
        const bg: Rgb = [localEstimate[index * 3]!, localEstimate[index * 3 + 1]!, localEstimate[index * 3 + 2]!]
        const axis: Rgb = [inkRgb[0] - bg[0], inkRgb[1] - bg[1], inkRgb[2] - bg[2]]
        const length = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]
        if (length <= 0) {
          continue
        }
        const value = pixel(image, index)
        const t =
          ((value[0] - bg[0]) * axis[0] + (value[1] - bg[1]) * axis[1] + (value[2] - bg[2]) * axis[2]) / length
        shapeMask[index] = t >= 0.5 ? 1 : 0
      }
    }
  }

  const runs: number[] = []
  for (let y = textRect.y; y < textRect.y + textRect.height; y += 1) {
    let run = 0
    for (let x = textRect.x; x <= textRect.x + textRect.width; x += 1) {
      if (x < textRect.x + textRect.width && cleanCore[y * width + x]) {
        run += 1
      } else if (run > 0) {
        runs.push(run)
        run = 0
      }
    }
  }
  const strokeWidthPx = median(runs)

  if (coreInText === 0) {
    warnings.push('No text pixels stand out inside the box — check that it covers the text.')
  }
  if (inkCoverage > MOSTLY_INK_COVERAGE) {
    warnings.push(
      'More than half of the box is ink. It may contain a barcode, logo or solid shape; reconstruction is unreliable there.',
    )
  }
  if (hasLines) {
    warnings.push(
      'Straight lines cross the region. They are kept as-is; glyph pixels touching a line are not repaired.',
    )
  }
  switch (kind) {
    case 'gradient':
      warnings.push('The background is a gradient. The repair follows the fitted colour ramp.')
      break
    case 'textured':
      warnings.push(
        'The background is textured (paper grain, halftone or photo). Repaired pixels are smoothed and may look softer than their surroundings.',
      )
      break
    case 'complex':
      warnings.push(
        'High-contrast detail surrounds the text (logo, barcode, photo or other text). Local repair cannot recreate that detail — inspect the preview closely or choose a smaller region.',
      )
      break
    default:
      break
  }

  return {
    kind,
    backgroundColor: toHex(centre),
    inkColor,
    planes,
    residualStd,
    localNoise,
    ringOutlierRatio,
    edgeDensity,
    gradientSpan,
    crossingLineRows,
    crossingLineColumns,
    localEstimate,
    repairMask,
    inkMask: shapeMask,
    repairPixelCount,
    inkCoverage,
    strokeWidthPx,
    warnings,
  }
}

export function cropRgba(image: RgbaImage, rect: PixelRect): RgbaImage {
  const data = new Uint8ClampedArray(rect.width * rect.height * 4)
  for (let y = 0; y < rect.height; y += 1) {
    const start = ((rect.y + y) * image.width + rect.x) * 4
    data.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4)
  }
  return { data, width: rect.width, height: rect.height }
}

export function autoRepairMethod(kind: RegionBackgroundKind): BackgroundRepairMethod {
  switch (kind) {
    case 'solid':
      return 'solid'
    case 'gradient':
      return 'gradient'
    default:
      return 'inpaint'
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Chebyshev distance to the nearest kept pixel, to size the diffusion. */
function maxMaskDepth(mask: Uint8Array, width: number, height: number): number {
  let frontier: number[] = []
  const depth = new Int32Array(mask.length).fill(-1)
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      depth[index] = 0
      frontier.push(index)
    }
  }
  let level = 0
  while (frontier.length > 0) {
    const next: number[] = []
    for (const index of frontier) {
      const x = index % width
      const y = Math.floor(index / width)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue
        }
        const neighbor = ny * width + nx
        if (depth[neighbor] === -1) {
          depth[neighbor] = level + 1
          next.push(neighbor)
        }
      }
    }
    if (next.length > 0) {
      level += 1
    }
    frontier = next
  }
  return level
}

/**
 * Rebuilds only the masked glyph pixels. Everything else stays transparent so the
 * original page shows through untouched.
 */
export function repairBackground(
  image: RgbaImage,
  analysis: RegionBackgroundAnalysis,
  method: BackgroundRepairMethod,
  options: { seed?: number } = {},
): BackgroundRepairResult {
  const { width, height } = image
  const mask = analysis.repairMask
  const notes: string[] = []
  const values = new Float32Array(width * height * 3)
  const solid = evaluate(analysis.planes, width / 2, height / 2)
  for (let index = 0; index < width * height; index += 1) {
    const original = pixel(image, index)
    let base: Rgb = original
    if (mask[index]) {
      if (method === 'solid') {
        base = solid
      } else if (method === 'gradient') {
        base = evaluate(analysis.planes, index % width, Math.floor(index / width))
      } else {
        base = [
          analysis.localEstimate[index * 3]!,
          analysis.localEstimate[index * 3 + 1]!,
          analysis.localEstimate[index * 3 + 2]!,
        ]
      }
    }
    values[index * 3] = base[0]
    values[index * 3 + 1] = base[1]
    values[index * 3 + 2] = base[2]
  }

  if (method === 'inpaint' && analysis.repairPixelCount > 0) {
    // Harmonic fill: each rebuilt pixel converges to the average of its neighbours, so
    // colours flow in from the kept pixels around each glyph.
    const depth = maxMaskDepth(mask, width, height)
    const iterations = Math.min(400, Math.max(30, depth * 8 + 30))
    const masked: number[] = []
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index]) {
        masked.push(index)
      }
    }
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const index of masked) {
        const x = index % width
        const y = Math.floor(index / width)
        let r = 0
        let g = 0
        let b = 0
        let count = 0
        for (const neighbor of [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ]) {
          if (neighbor < 0) {
            continue
          }
          r += values[neighbor * 3]!
          g += values[neighbor * 3 + 1]!
          b += values[neighbor * 3 + 2]!
          count += 1
        }
        if (count > 0) {
          values[index * 3] = r / count
          values[index * 3 + 1] = g / count
          values[index * 3 + 2] = b / count
        }
      }
    }
  }

  // Grain follows the paper right next to the glyphs, not distant edges or lines.
  const grain = Math.min(analysis.localNoise, analysis.residualStd, 14) * 0.9
  const random = mulberry32(options.seed ?? 0x5eed)
  const pixels = new Uint8ClampedArray(width * height * 4)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let seamSum = 0
  let seamCount = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) {
      continue
    }
    const x = index % width
    const y = Math.floor(index / width)
    // Approximately normal noise (sum of uniforms) so flat fills match scan grain.
    const noise = grain > 1.5 ? (random() + random() + random() - 1.5) * 2 * grain : 0
    const offset = index * 4
    pixels[offset] = values[index * 3]! + noise
    pixels[offset + 1] = values[index * 3 + 1]! + noise
    pixels[offset + 2] = values[index * 3 + 2]! + noise
    let boundary = false
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue
      }
      const neighbor = ny * width + nx
      if (!mask[neighbor]) {
        boundary = true
        seamSum += distance(
          [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!],
          pixel(image, neighbor),
        ) / Math.sqrt(3)
        seamCount += 1
      }
    }
    // Softer edge so the repair blends into the kept pixels.
    pixels[offset + 3] = boundary ? 210 : 255
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  const seamScore = seamCount > 0 ? seamSum / seamCount : 0
  if (analysis.repairPixelCount === 0) {
    notes.push('No glyph pixels were found to remove; only the new text will be drawn.')
  } else if (seamScore <= SMOOTH_SEAM_SCORE) {
    notes.push(
      `Edges of the repaired area blend with their surroundings (measured colour step ${seamScore.toFixed(1)}). This checks continuity only — compare the preview with the original.`,
    )
  } else {
    notes.push(
      `Edges of the repaired area differ from their surroundings (measured colour step ${seamScore.toFixed(1)}); seams are likely visible.`,
    )
  }
  if (method === 'inpaint' && (analysis.kind === 'textured' || analysis.kind === 'complex')) {
    notes.push('Inpainting smooths across the gap; it cannot recreate photo detail, patterns, logos or barcodes.')
  }

  return {
    pixels,
    width,
    height,
    repairedBounds:
      maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    method,
    seamScore,
    notes,
  }
}
