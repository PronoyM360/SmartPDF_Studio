import { OPS, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import {
  createPageDisplayTransform,
  pdfRectToScreenBounds,
  screenRectToPdfRect,
} from '@/lib/pdf/coordinateTransform'
import type { PageRect } from '@/types'
import type { SectionTextRun } from '@/types/documentSections'
import type { OcrTextItem } from '@/types/ocr'

/**
 * Layout analysis happens in a "reading frame": the page rotated so the dominant text
 * reads left-to-right. That differs from the on-screen orientation when a page's
 * /Rotate turns horizontal text sideways.
 */
export interface PageGeometry {
  readonly pageIndex: number
  /** The page's own /Rotate value (on-screen orientation). */
  readonly rotation: number
  readonly readingRotation: number
  readonly displayWidth: number
  readonly displayHeight: number
  readonly toDisplayRect: (pdfRect: PageRect) => PageRect
  readonly toPdfRect: (displayRect: PageRect) => PageRect
}

export interface PageTextAnalysis extends PageGeometry {
  readonly runs: readonly SectionTextRun[]
  readonly textCharCount: number
  readonly hasImages: boolean | null
}

export const IMAGE_OPS: ReadonlySet<number> = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintSolidColorImageMask,
])

/** Below this many characters a page is treated as image-only (scanned). */
export const MIN_SELECTABLE_TEXT_CHARS = 20

export async function readPageGeometry(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PageGeometry> {
  const page = await pdf.getPage(pageIndex + 1)
  return geometryForPage(page, pageIndex, page.rotate)
}

function geometryForPage(
  page: PDFPageProxy,
  pageIndex: number,
  readingRotation: number,
): PageGeometry {
  const viewport = page.getViewport({ scale: 1, rotation: readingRotation })
  const transform = createPageDisplayTransform(pageIndex, viewport)
  return {
    pageIndex,
    rotation: page.rotate,
    readingRotation,
    displayWidth: viewport.width,
    displayHeight: viewport.height,
    toDisplayRect: (pdfRect) => pdfRectToScreenBounds(transform, pdfRect),
    toPdfRect: (displayRect) => screenRectToPdfRect(transform, displayRect),
  }
}

/**
 * Viewport rotation (clockwise) that makes the dominant text direction read
 * left-to-right. User-space angles are counter-clockwise, so they map 1:1.
 */
export function dominantReadingRotation(
  items: readonly { text: string; directionDeg?: number }[],
): number | null {
  const weights = new Map<number, number>()
  for (const item of items) {
    if (item.directionDeg === undefined) {
      continue
    }
    const snapped = (Math.round(item.directionDeg / 90) * 90) % 360
    weights.set(snapped, (weights.get(snapped) ?? 0) + item.text.trim().length)
  }
  let best: number | null = null
  let bestWeight = 0
  for (const [angle, weight] of weights) {
    if (weight > bestWeight) {
      best = angle
      bestWeight = weight
    }
  }
  return best
}

async function pageHasImages(page: PDFPageProxy): Promise<boolean | null> {
  try {
    const operatorList = await page.getOperatorList()
    return operatorList.fnArray.some((fn) => IMAGE_OPS.has(fn))
  } catch {
    return null
  }
}

/** Selectable text runs (PDF user space) plus page geometry and an image-content check. */
export async function analyzePageText(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PageTextAnalysis> {
  const page = await pdf.getPage(pageIndex + 1)
  const [items, hasImages] = await Promise.all([
    extractPageTextItems(pdf, pageIndex),
    pageHasImages(page),
  ])
  const runs: SectionTextRun[] = items.map((item) => ({
    text: item.text,
    bounds: item.bounds,
    fontSizePt: item.fontSizePt,
    confidence: null,
  }))
  const textCharCount = items.reduce(
    (sum, item) => sum + item.text.replace(/\s/g, '').length,
    0,
  )
  const readingRotation = dominantReadingRotation(items) ?? page.rotate
  return {
    ...geometryForPage(page, pageIndex, readingRotation),
    runs,
    textCharCount,
    hasImages,
  }
}

function intersectionArea(a: PageRect, b: PageRect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * OCR words → runs, dropping words that mostly overlap selectable text so hybrid
 * pages only add sections for text that lives inside images.
 */
export function ocrItemsToRuns(
  items: readonly OcrTextItem[],
  selectableRuns: readonly SectionTextRun[],
): SectionTextRun[] {
  return items
    .filter((item) => item.text.trim())
    .filter((item) => {
      const area = item.bounds.width * item.bounds.height
      if (area <= 0) {
        return false
      }
      return !selectableRuns.some(
        (run) => intersectionArea(run.bounds, item.bounds) >= area * 0.5,
      )
    })
    .map((item) => ({
      text: item.text,
      bounds: item.bounds,
      fontSizePt: null,
      confidence: item.confidence,
    }))
}

/** Runs whose centre lies inside a PDF-space region. */
export function runsInsideRegion(
  runs: readonly SectionTextRun[],
  region: PageRect,
): SectionTextRun[] {
  return runs.filter((run) => {
    const cx = run.bounds.x + run.bounds.width / 2
    const cy = run.bounds.y + run.bounds.height / 2
    return (
      cx >= region.x &&
      cx <= region.x + region.width &&
      cy >= region.y &&
      cy <= region.y + region.height
    )
  })
}
