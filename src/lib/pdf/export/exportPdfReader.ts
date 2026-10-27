import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { openPdfDocument } from '@/lib/pdf/openPdfDocument'
import type { PageTextRun } from '@/lib/redaction/types'
import type { PageRect } from '@/types'

/** RGBA pixels of an unrotated render on white; `view` is PDF.js `page.view`. */
export interface RenderedPage {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  readonly scale: number
  readonly view: PageRect
}

export interface ExportPdfPageGeometry {
  /** Visible area (CropBox clipped to MediaBox), PDF user space. */
  readonly view: PageRect
  readonly rotation: number
}

export interface ExportPdfPageContent {
  readonly text: readonly PageTextRun[]
  readonly annotationCount: number
}

/** Read access to a reopened PDF for post-export validation. */
export interface ExportPdfReader {
  readonly pageCount: number
  readGeometry(pageIndex: number): Promise<ExportPdfPageGeometry>
  readContent(pageIndex: number): Promise<ExportPdfPageContent>
  /** Null where no canvas implementation is available. */
  renderPage(pageIndex: number, scale: number): Promise<RenderedPage | null>
  destroy(): Promise<void>
}

export type OpenExportPdfReader = (bytes: Uint8Array) => Promise<ExportPdfReader>

interface CanvasPair {
  canvas: unknown
  context: CanvasRenderingContext2D | null
}

interface CanvasFactoryLike {
  create(width: number, height: number): CanvasPair
  destroy(pair: CanvasPair): void
}

function isCanvasFactory(value: unknown): value is CanvasFactoryLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CanvasFactoryLike).create === 'function' &&
    typeof (value as CanvasFactoryLike).destroy === 'function'
  )
}

function viewRect(view: readonly number[]): PageRect {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Wraps an open PDF.js document; works with the browser and the legacy (Node) build. */
export function createPdfJsExportReader(pdf: PDFDocumentProxy): ExportPdfReader {
  return {
    pageCount: pdf.numPages,
    async readGeometry(pageIndex) {
      const page = await pdf.getPage(pageIndex + 1)
      return { view: viewRect(page.view), rotation: page.rotate }
    },
    async readContent(pageIndex) {
      const page = await pdf.getPage(pageIndex + 1)
      const items = await extractPageTextItems(pdf, pageIndex)
      const annotations = await page.getAnnotations()
      return {
        text: items.map((item) => ({ text: item.text, bounds: item.bounds })),
        annotationCount: annotations.length,
      }
    },
    async renderPage(pageIndex, scale) {
      const factory = (pdf as { canvasFactory?: unknown }).canvasFactory
      if (!isCanvasFactory(factory)) {
        return null
      }
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale, rotation: 0 })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      let pair: CanvasPair
      try {
        pair = factory.create(width, height)
      } catch {
        return null
      }
      try {
        const context = pair.context
        if (!context) {
          return null
        }
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
        await page.render({
          canvasContext: context,
          viewport,
          canvas: pair.canvas as HTMLCanvasElement,
        }).promise
        const data = context.getImageData(0, 0, width, height).data
        return { width, height, data: new Uint8ClampedArray(data), scale, view: viewRect(page.view) }
      } catch {
        return null
      } finally {
        factory.destroy(pair)
        page.cleanup()
      }
    },
    destroy: () => pdf.loadingTask.destroy(),
  }
}

export const openBrowserExportReader: OpenExportPdfReader = async (bytes) => {
  const { pdf } = await openPdfDocument(bytes)
  return createPdfJsExportReader(pdf)
}
