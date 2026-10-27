import type { PageRect } from '@/types'

/** Text run in rotated display space at scale 1 (top-left origin, y grows downward). */
export interface LayoutRun {
  readonly text: string
  readonly rect: PageRect
  readonly fontSize: number
  readonly confidence: number | null
}

/** Horizontally contiguous text on one visual line. */
export interface LayoutSegment {
  readonly id: number
  readonly row: number
  readonly text: string
  readonly rect: PageRect
  readonly fontSize: number
  readonly runs: readonly LayoutRun[]
}

export interface LayoutBlock {
  readonly segments: readonly LayoutSegment[]
  readonly rect: PageRect
}

export function rectBottom(rect: PageRect): number {
  return rect.y + rect.height
}

export function rectRight(rect: PageRect): number {
  return rect.x + rect.width
}

export function unionRects(rects: readonly PageRect[]): PageRect {
  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map(rectRight))
  const maxY = Math.max(...rects.map(rectBottom))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function horizontalOverlap(a: PageRect, b: PageRect): number {
  return Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x)
}

function verticalOverlap(a: PageRect, b: PageRect): number {
  return Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y)
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

interface LineCluster {
  centerSum: number
  heightSum: number
  count: number
  runs: LayoutRun[]
}

function clusterBand(line: LineCluster): PageRect {
  const center = line.centerSum / line.count
  const height = line.heightSum / line.count
  return { x: 0, y: center - height / 2, width: 1, height }
}

function joinRunText(runs: readonly LayoutRun[]): string {
  let text = ''
  let previous: LayoutRun | null = null
  for (const run of runs) {
    const piece = run.text
    if (previous) {
      const gap = run.rect.x - rectRight(previous.rect)
      const spaceAlready = /\s$/.test(text) || /^\s/.test(piece)
      if (!spaceAlready && gap > Math.min(run.fontSize, previous.fontSize) * 0.12) {
        text += ' '
      }
    }
    text += piece
    previous = run
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Clusters runs into visual lines by vertical overlap, then splits each line at
 * wide horizontal gaps so side-by-side columns stay separate.
 */
export function groupRunsIntoSegments(runs: readonly LayoutRun[]): LayoutSegment[] {
  const usable = runs.filter(
    (run) => run.text.trim() && run.rect.width > 0 && run.rect.height > 0,
  )
  const sorted = [...usable].sort(
    (a, b) =>
      a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2) || a.rect.x - b.rect.x,
  )

  const lines: LineCluster[] = []
  for (const run of sorted) {
    let best: LineCluster | null = null
    let bestRatio = 0
    for (const line of lines) {
      const band = clusterBand(line)
      const minHeight = Math.min(band.height, run.rect.height)
      if (minHeight <= 0) {
        continue
      }
      const ratio = verticalOverlap(band, run.rect) / minHeight
      if (ratio >= 0.5 && ratio > bestRatio) {
        best = line
        bestRatio = ratio
      }
    }
    const center = run.rect.y + run.rect.height / 2
    if (best) {
      best.runs.push(run)
      best.centerSum += center
      best.heightSum += run.rect.height
      best.count += 1
    } else {
      lines.push({ centerSum: center, heightSum: run.rect.height, count: 1, runs: [run] })
    }
  }

  lines.sort((a, b) => a.centerSum / a.count - b.centerSum / b.count)

  const segments: LayoutSegment[] = []
  lines.forEach((line, row) => {
    const ordered = [...line.runs].sort((a, b) => a.rect.x - b.rect.x)
    let current: LayoutRun[] = []
    const flush = () => {
      if (current.length === 0) {
        return
      }
      const text = joinRunText(current)
      if (text) {
        segments.push({
          id: segments.length,
          row,
          text,
          rect: unionRects(current.map((run) => run.rect)),
          fontSize: median(current.map((run) => run.fontSize)),
          runs: current,
        })
      }
      current = []
    }
    for (const run of ordered) {
      const previous = current[current.length - 1]
      if (previous) {
        const fontSize = (previous.fontSize + run.fontSize) / 2
        const gap = run.rect.x - rectRight(previous.rect)
        if (gap > Math.max(fontSize * 2.2, 10)) {
          flush()
        }
      }
      current.push(run)
    }
    flush()
  })

  return segments
}

/**
 * Stacks segments into blocks when they are vertically close and horizontally
 * aligned (overlapping or sharing a left edge).
 */
export function groupSegmentsIntoBlocks(segments: readonly LayoutSegment[]): LayoutBlock[] {
  interface MutableBlock {
    segments: LayoutSegment[]
    rect: PageRect
    lastRow: number
    lastFontSize: number
  }
  const ordered = [...segments].sort((a, b) => a.row - b.row || a.rect.x - b.rect.x)
  const blocks: MutableBlock[] = []

  for (const segment of ordered) {
    let best: MutableBlock | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (const block of blocks) {
      if (segment.row <= block.lastRow) {
        continue
      }
      const gap = segment.rect.y - rectBottom(block.rect)
      const maxGap = 0.9 * Math.max(segment.fontSize, block.lastFontSize)
      if (gap > maxGap || gap < -segment.rect.height * 0.5) {
        continue
      }
      const aligned =
        horizontalOverlap(block.rect, segment.rect) > 0 ||
        Math.abs(block.rect.x - segment.rect.x) <= segment.fontSize * 1.5
      if (!aligned) {
        continue
      }
      if (gap < bestGap) {
        best = block
        bestGap = gap
      }
    }
    if (best) {
      best.segments.push(segment)
      best.rect = unionRects([best.rect, segment.rect])
      best.lastRow = segment.row
      best.lastFontSize = segment.fontSize
    } else {
      blocks.push({
        segments: [segment],
        rect: segment.rect,
        lastRow: segment.row,
        lastFontSize: segment.fontSize,
      })
    }
  }

  return blocks
    .map((block) => ({ segments: block.segments, rect: block.rect }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}

/** Rebuilds readable text: segments on the same row joined by wide spaces, rows by newlines. */
export function segmentsToText(segments: readonly LayoutSegment[]): string {
  const rows = new Map<number, LayoutSegment[]>()
  for (const segment of segments) {
    const list = rows.get(segment.row) ?? []
    list.push(segment)
    rows.set(segment.row, list)
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) =>
      list
        .sort((a, b) => a.rect.x - b.rect.x)
        .map((segment) => segment.text)
        .join('   '),
    )
    .join('\n')
}
