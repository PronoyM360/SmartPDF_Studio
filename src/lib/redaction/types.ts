import type { PageRect } from '@/types'

export interface PageTextRun {
  readonly text: string
  /** PDF user space. */
  readonly bounds: PageRect
}

export interface RedactionArea {
  readonly bounds: PageRect
  readonly fillColor: string
}

export interface RasterizedPage {
  readonly png: Uint8Array
  /** Visible page area (PDF user space) that the image covers. */
  readonly visibleBox: PageRect
}

/** Read access to a PDF for redaction; browser builds use PDF.js + canvas. */
export interface PdfInspector {
  readonly pageCount: number
  readPageText(pageIndex: number): Promise<PageTextRun[]>
  /** Renders the page (unrotated) with the areas painted in. Undefined where no canvas exists. */
  rasterizeWithRedactions?(
    pageIndex: number,
    areas: readonly RedactionArea[],
  ): Promise<RasterizedPage>
  /** Share (0–1) of rendered pixels inside `rect` matching `fillColor`; null if rendering is unavailable. */
  measureFillCoverage(pageIndex: number, rect: PageRect, fillColor: string): Promise<number | null>
  destroy(): Promise<void>
}

export type OpenPdfInspector = (bytes: Uint8Array) => Promise<PdfInspector>
