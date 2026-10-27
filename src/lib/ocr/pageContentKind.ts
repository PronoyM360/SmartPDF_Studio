import type { PageContentAssessment, PageContentKind } from '@/types/ocr'

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** Below ~150 dpi OCR accuracy drops and repaired pixels look soft. */
export const LOW_RESOLUTION_PIXELS_PER_POINT = 150 / 72
const IMAGE_DOMINANT_RATIO = 0.5
const IMAGE_PRESENT_RATIO = 0.1
const TEXT_LAYER_MIN_CHARS = 20

export interface ImageOpCodes {
  readonly save: number
  readonly restore: number
  readonly transform: number
  readonly paintFormXObjectBegin: number
  readonly paintFormXObjectEnd: number
  readonly paintImageXObject: number
  readonly paintInlineImageXObject: number
  readonly paintImageMaskXObject: number
}

export interface ImagePlacement {
  /** Axis-aligned bounds in PDF user space. */
  readonly bounds: { x: number; y: number; width: number; height: number }
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly pixelsPerPoint: number | null
}

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

function asMatrix(value: unknown): Matrix | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    return null
  }
  const list = Array.from(value as ArrayLike<number>)
  return list.length >= 6 && list.slice(0, 6).every(Number.isFinite)
    ? (list.slice(0, 6) as Matrix)
    : null
}

function imageSize(args: readonly unknown[]): { width: number; height: number } | null {
  const [first, second, third] = args
  if (typeof second === 'number' && typeof third === 'number') {
    return { width: second, height: third }
  }
  if (first && typeof first === 'object') {
    const { width, height } = first as { width?: unknown; height?: unknown }
    if (typeof width === 'number' && typeof height === 'number') {
      return { width, height }
    }
  }
  return null
}

/**
 * Walks a PDF.js operator list and returns where images are painted. Images are
 * drawn into the unit square, so the CTM at paint time gives their placement.
 */
export function collectImagePlacements(
  fnArray: readonly number[],
  argsArray: readonly (readonly unknown[] | null)[],
  ops: ImageOpCodes,
): ImagePlacement[] {
  const placements: ImagePlacement[] = []
  const stack: Matrix[] = []
  let ctm: Matrix = IDENTITY

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index] ?? []
    if (fn === ops.save) {
      stack.push(ctm)
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY
    } else if (fn === ops.transform) {
      const matrix = asMatrix(args)
      if (matrix) {
        ctm = multiply(ctm, matrix)
      }
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm)
      const matrix = asMatrix(args[0])
      if (matrix) {
        ctm = multiply(ctm, matrix)
      }
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY
    } else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageMaskXObject
    ) {
      const size = imageSize(args)
      const corners = [
        [ctm[4], ctm[5]],
        [ctm[0] + ctm[4], ctm[1] + ctm[5]],
        [ctm[2] + ctm[4], ctm[3] + ctm[5]],
        [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
      ]
      const xs = corners.map((corner) => corner[0]!)
      const ys = corners.map((corner) => corner[1]!)
      const placedWidth = Math.hypot(ctm[0], ctm[1])
      const placedHeight = Math.hypot(ctm[2], ctm[3])
      const pixelsPerPoint =
        size && placedWidth > 0 && placedHeight > 0
          ? Math.sqrt((size.width / placedWidth) * (size.height / placedHeight))
          : null
      placements.push({
        bounds: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
        pixelWidth: size?.width ?? 0,
        pixelHeight: size?.height ?? 0,
        pixelsPerPoint,
      })
    }
  }
  return placements
}

function clippedArea(
  rect: ImagePlacement['bounds'],
  view: readonly [number, number, number, number],
): number {
  const width = Math.min(rect.x + rect.width, view[2]) - Math.max(rect.x, view[0])
  const height = Math.min(rect.y + rect.height, view[3]) - Math.max(rect.y, view[1])
  return width > 0 && height > 0 ? width * height : 0
}

export function classifyPageContent(input: {
  pageIndex: number
  /** Page view box `[x0, y0, x1, y1]` in user space. */
  view: readonly [number, number, number, number]
  textCharCount: number
  textArea: number
  images: readonly ImagePlacement[]
}): PageContentAssessment {
  const pageArea = Math.max(1, (input.view[2] - input.view[0]) * (input.view[3] - input.view[1]))
  const imageAreaRatio = Math.min(
    1,
    input.images.reduce((sum, image) => sum + clippedArea(image.bounds, input.view), 0) / pageArea,
  )
  const textAreaRatio = Math.min(1, input.textArea / pageArea)
  const dominant = [...input.images].sort(
    (a, b) => clippedArea(b.bounds, input.view) - clippedArea(a.bounds, input.view),
  )[0]
  const dominantImagePixelsPerPoint = dominant?.pixelsPerPoint ?? null
  const hasTextLayer = input.textCharCount >= TEXT_LAYER_MIN_CHARS

  let kind: PageContentKind
  if (imageAreaRatio >= IMAGE_DOMINANT_RATIO) {
    kind = hasTextLayer ? 'mixed' : 'image'
  } else if (imageAreaRatio >= IMAGE_PRESENT_RATIO) {
    kind = input.textCharCount > 0 ? 'mixed' : 'image'
  } else {
    kind = input.textCharCount > 0 ? 'text' : 'empty'
  }

  const lowResolution =
    kind !== 'text' &&
    dominantImagePixelsPerPoint !== null &&
    dominantImagePixelsPerPoint < LOW_RESOLUTION_PIXELS_PER_POINT

  const dpi =
    dominantImagePixelsPerPoint !== null ? Math.round(dominantImagePixelsPerPoint * 72) : null
  const coverage = `${Math.round(imageAreaRatio * 100)}%`
  let summary: string
  switch (kind) {
    case 'image':
      summary = `Mostly image content (${coverage} of the page${dpi ? `, about ${dpi} dpi` : ''}) with no selectable text. Use OCR to find and edit text.`
      break
    case 'mixed':
      summary = hasTextLayer && imageAreaRatio >= IMAGE_DOMINANT_RATIO
        ? `Scanned image (${coverage} of the page${dpi ? `, about ${dpi} dpi` : ''}) with a selectable text layer. The text layer may be invisible OCR text — edit visible image text with OCR.`
        : `Selectable text plus images (${coverage} of the page). Use the text tools for selectable text and OCR for text inside images.`
      break
    case 'text':
      summary =
        'Selectable PDF text. The text tools edit it more precisely than OCR; use OCR only for text inside small images.'
      break
    default:
      summary =
        'No selectable text or images were found. Text may be drawn as vector shapes — OCR can still read it.'
  }

  return {
    pageIndex: input.pageIndex,
    kind,
    textCharCount: input.textCharCount,
    textAreaRatio,
    imageAreaRatio,
    imageCount: input.images.length,
    dominantImagePixelsPerPoint,
    lowResolution,
    summary,
  }
}
