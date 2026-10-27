import { PDFHexString, PDFString, type PDFDocument, type PDFPage } from 'pdf-lib'
import type { AnnotationOverlayObject } from '@/types/annotationOverlay'
import { hexToRgbColor } from './colorUtils'

const BORDER_WIDTH = 1.5
export const ANNOTATION_AUTHOR = 'SmartPDF Studio'

/**
 * Adds each annotation as a standard PDF Square annotation: an outline drawn by the
 * viewer plus the note as its comment text. The page content stream is not touched,
 * so readers can hide, move or delete the annotation.
 */
export function addAnnotationsToPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  annotations: readonly AnnotationOverlayObject[],
): number {
  let added = 0
  for (const annotation of annotations) {
    const { x, y, width, height } = annotation.bounds
    if (!(width > 0 && height > 0)) {
      continue
    }
    const color = hexToRgbColor(annotation.color)
    const rgb = [color.red, color.green, color.blue].map((value) => value.toFixed(3)).join(' ')
    const inset = BORDER_WIDTH / 2
    // Own appearance so every viewer draws the same dashed outline.
    const appearance = pdfDoc.context.register(
      pdfDoc.context.stream(
        `q ${rgb} RG ${BORDER_WIDTH} w [4 2] 0 d ${inset} ${inset} ${Math.max(0, width - BORDER_WIDTH)} ${Math.max(0, height - BORDER_WIDTH)} re S Q`,
        { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, width, height] },
      ),
    )
    const annot = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [x, y, x + width, y + height],
      Contents: PDFHexString.fromText(annotation.note),
      T: PDFHexString.fromText(ANNOTATION_AUTHOR),
      NM: PDFString.of(annotation.id),
      M: PDFString.fromDate(new Date(annotation.updatedAt)),
      C: [color.red, color.green, color.blue],
      BS: { Type: 'Border', W: BORDER_WIDTH, S: 'D', D: [4, 2] },
      // Print flag, so the outline also appears on paper.
      F: 4,
      AP: { N: appearance },
    })
    page.node.addAnnot(pdfDoc.context.register(annot))
    added += 1
  }
  return added
}