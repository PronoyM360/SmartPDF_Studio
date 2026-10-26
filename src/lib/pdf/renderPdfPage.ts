import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'

export interface RenderPdfPageOptions {
  page: PDFPageProxy
  canvas: HTMLCanvasElement
  scale: number
  devicePixelRatio?: number
}

export function renderPdfPage(options: RenderPdfPageOptions): RenderTask {
  const { page, canvas, scale } = options
  const outputScale = options.devicePixelRatio ?? window.devicePixelRatio ?? 1
  const viewport = page.getViewport({ scale })
  const pixelWidth = Math.floor(viewport.width * outputScale)
  const pixelHeight = Math.floor(viewport.height * outputScale)

  canvas.width = pixelWidth
  canvas.height = pixelHeight
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is not available.')
  }

  const transform =
    outputScale !== 1
      ? [outputScale, 0, 0, outputScale, 0, 0]
      : undefined

  return page.render({
    canvasContext: context,
    viewport,
    transform,
    canvas,
  })
}
