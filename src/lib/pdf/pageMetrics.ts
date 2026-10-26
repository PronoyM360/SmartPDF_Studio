import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfPageMeta } from '@/types'

export async function readPageMeta(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PdfPageMeta> {
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const rotation = page.rotate as 0 | 90 | 180 | 270
  const mediaBox = viewport.viewBox
  return {
    pageIndex,
    width: viewport.width,
    height: viewport.height,
    rotation,
    mediaBox: {
      x: mediaBox[0] ?? 0,
      y: mediaBox[1] ?? 0,
      width: (mediaBox[2] ?? 0) - (mediaBox[0] ?? 0),
      height: (mediaBox[3] ?? 0) - (mediaBox[1] ?? 0),
    },
  }
}
