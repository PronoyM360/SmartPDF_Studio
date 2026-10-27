import type { PriceTextMetrics } from '@/lib/prices/buildPriceReplacementPlan'
import { konvaFirstBaselineOffset } from '@/lib/pdf/export/textOverlayLayout'

let measureContext: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return measureContext
}

export function canvasFont(
  fontFamily: string,
  fontWeight: 'normal' | 'bold',
  fontSize: number,
  italic = false,
): string {
  return `${italic ? 'italic ' : ''}${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`
}

/** Widths and baseline offsets measured exactly as Konva and the export rasterizer draw. */
export const canvasTextMetrics: PriceTextMetrics = {
  measureWidth(text, fontFamily, fontWeight, fontSize, letterSpacing) {
    const ctx = context()
    if (!ctx) {
      return null
    }
    ctx.font = canvasFont(fontFamily, fontWeight, fontSize)
    return ctx.measureText(text).width + letterSpacing * [...text].length
  },
  baselineFromTop(fontFamily, fontWeight, fontSize) {
    const ctx = context()
    if (!ctx) {
      return null
    }
    ctx.font = canvasFont(fontFamily, fontWeight, fontSize)
    return konvaFirstBaselineOffset(ctx, fontSize)
  },
}

/**
 * Width of the inked glyphs only (no side bearings), comparable to an OCR box that
 * hugs the scanned glyphs.
 */
export function measureInkWidth(
  text: string,
  fontFamily: string,
  fontWeight: 'normal' | 'bold',
  fontSize: number,
): number | null {
  const ctx = context()
  if (!ctx) {
    return null
  }
  ctx.font = canvasFont(fontFamily, fontWeight, fontSize)
  const metrics = ctx.measureText(text)
  const ink = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
  return Number.isFinite(ink) && ink > 0 ? ink : metrics.width
}

/** Detects whether a system font is installed by comparing against generic fallbacks. */
export function isSystemFontAvailable(family: string): boolean {
  const ctx = context()
  if (!ctx) {
    return false
  }
  const sample = 'mmmmmmmmmlli 0123456789'
  return (['monospace', 'serif'] as const).some((generic) => {
    ctx.font = `72px ${generic}`
    const base = ctx.measureText(sample).width
    ctx.font = `72px "${family}", ${generic}`
    return Math.abs(ctx.measureText(sample).width - base) > 0.5
  })
}
