import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  analyzeRegionBackground,
  autoRepairMethod,
  cropRgba,
  repairBackground,
  type BackgroundRepairResult,
  type PixelRect,
  type RegionBackgroundAnalysis,
  type RgbaImage,
} from '@/lib/ocr/backgroundRepair'
import {
  choosePatchPixelsPerPoint,
  renderPdfRegion,
  rgbaToPngBytes,
} from '@/lib/ocr/renderPdfRegion'
import {
  createPageDisplayTransform,
  pdfRectToScreenBounds,
  screenRectToPdfRect,
  type PageDisplayTransform,
} from '@/lib/pdf'
import type { BackgroundRepairChoice, BackgroundRepairMethod } from '@/types/backgroundRepair'
import type { PageRect } from '@/types'

const DEBOUNCE_MS = 220

export interface RepairPatch {
  readonly bytes: Uint8Array
  /** Object URL for previews; revoked when the result is replaced or the dialog closes. */
  readonly url: string
  readonly boundsPdf: PageRect
  readonly pixelWidth: number
  readonly pixelHeight: number
}

export interface OcrRegionRepairResult {
  /** Wide render around the text, for previews (display orientation). */
  readonly context: RgbaImage
  readonly contextDisplayBox: PageRect
  readonly pixelsPerPoint: number
  readonly baseTransform: PageDisplayTransform
  /** Glyph box in display points (scale 1). */
  readonly glyphDisplayBox: PageRect
  readonly analysis: RegionBackgroundAnalysis
  /** Size of the analysed window and the glyph box inside it, in pixels. */
  readonly analysisSize: { width: number; height: number }
  readonly textRectPx: PixelRect
  readonly method: BackgroundRepairMethod | 'flat-box'
  readonly repair: BackgroundRepairResult | null
  /** Where the tight analysis window sits inside `context`, in pixels. */
  readonly repairOffsetPx: { x: number; y: number }
  readonly patch: RepairPatch | null
}

export type OcrRegionRepairState =
  | { status: 'idle' }
  /** `previous` keeps the last result on screen while the region is re-analysed. */
  | { status: 'working'; previous: OcrRegionRepairResult | null }
  | { status: 'error'; error: string }
  | { status: 'ready'; result: OcrRegionRepairResult }

function expand(box: PageRect, dx: number, dy: number): PageRect {
  return { x: box.x - dx, y: box.y - dy, width: box.width + dx * 2, height: box.height + dy * 2 }
}

function toPixelRect(box: PageRect, origin: PageRect, ppp: number, limit: { width: number; height: number }): PixelRect {
  const x0 = Math.max(0, Math.floor((box.x - origin.x) * ppp))
  const y0 = Math.max(0, Math.floor((box.y - origin.y) * ppp))
  const x1 = Math.min(limit.width, Math.ceil((box.x + box.width - origin.x) * ppp))
  const y1 = Math.min(limit.height, Math.ceil((box.y + box.height - origin.y) * ppp))
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

/**
 * Renders the area around an OCR box at the scan's own resolution, studies the
 * background and rebuilds the glyph pixels. Re-runs when the box or method changes.
 */
export function useOcrRegionRepair(input: {
  enabled: boolean
  pdf: PDFDocumentProxy | null
  pageIndex: number
  glyphBoundsPdf: PageRect | null
  choice: BackgroundRepairChoice
  nativePixelsPerPoint: number | null
}): OcrRegionRepairState {
  const { enabled, pdf, pageIndex, glyphBoundsPdf, choice, nativePixelsPerPoint } = input
  const [state, setState] = useState<OcrRegionRepairState>({ status: 'idle' })
  const generationRef = useRef(0)
  const urlRef = useRef<string | null>(null)

  const boundsKey = glyphBoundsPdf
    ? [glyphBoundsPdf.x, glyphBoundsPdf.y, glyphBoundsPdf.width, glyphBoundsPdf.height]
        .map((value) => value.toFixed(2))
        .join(',')
    : ''

  useEffect(() => {
    const revoke = (): void => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
    if (!enabled || !pdf || !glyphBoundsPdf) {
      generationRef.current += 1
      revoke()
      setState({ status: 'idle' })
      return
    }
    const generation = generationRef.current + 1
    generationRef.current = generation
    setState((prev) => ({
      status: 'working',
      previous: prev.status === 'ready' ? prev.result : prev.status === 'working' ? prev.previous : null,
    }))

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const page = await pdf.getPage(pageIndex + 1)
          const baseTransform = createPageDisplayTransform(pageIndex, page.getViewport({ scale: 1 }))
          const glyph = pdfRectToScreenBounds(baseTransform, glyphBoundsPdf)
          // Wide enough horizontally to preview replacements up to ~2.3× the original width.
          const contextBox = expand(
            glyph,
            Math.max(glyph.height * 2.5, glyph.width * 1.3, 12),
            Math.max(glyph.height * 1.5, 8),
          )
          const region = await renderPdfRegion(
            pdf,
            pageIndex,
            contextBox,
            choosePatchPixelsPerPoint(nativePixelsPerPoint),
          )
          if (generationRef.current !== generation) {
            return
          }
          const ppp = region.pixelsPerPoint
          const limit = { width: region.image.width, height: region.image.height }
          // Learn the background from a tight ring only; a wide ring pulls in other content.
          const ring = Math.max(3 / ppp, Math.min(glyph.height * 0.6, 10))
          const tight = toPixelRect(expand(glyph, ring, ring), region.displayBox, ppp, limit)
          const glyphPx = toPixelRect(glyph, region.displayBox, ppp, limit)
          const textRect: PixelRect = {
            x: glyphPx.x - tight.x,
            y: glyphPx.y - tight.y,
            width: glyphPx.width,
            height: glyphPx.height,
          }
          const tightImage = cropRgba(region.image, tight)
          const analysis = analyzeRegionBackground(tightImage, textRect, {
            dilateRadius: ppp >= 3 ? 2 : 1,
          })

          const method: BackgroundRepairMethod | 'flat-box' =
            choice === 'flat-box' ? 'flat-box' : choice === 'auto' ? autoRepairMethod(analysis.kind) : choice
          let repair: BackgroundRepairResult | null = null
          let patch: RepairPatch | null = null
          if (method !== 'flat-box') {
            repair = repairBackground(tightImage, analysis, method)
            const crop = repair.repairedBounds
            if (crop) {
              const bytes = await rgbaToPngBytes(repair.pixels, repair.width, repair.height, crop)
              if (generationRef.current !== generation) {
                return
              }
              const displayBox: PageRect = {
                x: region.displayBox.x + (tight.x + crop.x) / ppp,
                y: region.displayBox.y + (tight.y + crop.y) / ppp,
                width: crop.width / ppp,
                height: crop.height / ppp,
              }
              revoke()
              const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }))
              urlRef.current = url
              patch = {
                bytes,
                url,
                boundsPdf: screenRectToPdfRect(baseTransform, displayBox),
                pixelWidth: crop.width,
                pixelHeight: crop.height,
              }
            }
          }
          if (!patch) {
            revoke()
          }
          setState({
            status: 'ready',
            result: {
              context: region.image,
              contextDisplayBox: region.displayBox,
              pixelsPerPoint: ppp,
              baseTransform,
              glyphDisplayBox: glyph,
              analysis,
              analysisSize: { width: tightImage.width, height: tightImage.height },
              textRectPx: textRect,
              method,
              repair,
              repairOffsetPx: { x: tight.x, y: tight.y },
              patch,
            },
          })
        } catch (cause) {
          if (generationRef.current === generation) {
            setState({
              status: 'error',
              error: cause instanceof Error ? cause.message : 'Could not analyse this region.',
            })
          }
        }
      })()
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
    // boundsKey stands in for glyphBoundsPdf so equal boxes do not re-run the repair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pdf, pageIndex, boundsKey, choice, nativePixelsPerPoint])

  useEffect(() => {
    return () => {
      generationRef.current += 1
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [])

  return state
}
