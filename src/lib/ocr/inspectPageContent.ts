import { OPS, type PDFDocumentProxy } from 'pdfjs-dist'
import { classifyPageContent, collectImagePlacements } from '@/lib/ocr/pageContentKind'
import { computeTextItemGeometry } from '@/lib/pdf/extractPageText'
import type { PageContentAssessment } from '@/types/ocr'

/** Reads the text layer and image placements of one page to decide whether OCR is needed. */
export async function inspectPageContent(
  pdf: PDFDocumentProxy,
  pageIndex: number,
): Promise<PageContentAssessment> {
  const page = await pdf.getPage(pageIndex + 1)
  const [textContent, operatorList] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ])

  let textCharCount = 0
  let textArea = 0
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) {
      continue
    }
    textCharCount += item.str.replace(/\s+/g, '').length
    const { bounds } = computeTextItemGeometry(item)
    textArea += bounds.width * bounds.height
  }

  const images = collectImagePlacements(operatorList.fnArray, operatorList.argsArray, OPS)
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view
  return classifyPageContent({
    pageIndex,
    view: [x0, y0, x1, y1],
    textCharCount,
    textArea,
    images,
  })
}
