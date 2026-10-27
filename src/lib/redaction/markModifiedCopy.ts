import { StandardFonts, degrees, rgb, type PDFDocument } from 'pdf-lib'

const NOTICE_SIZE_PT = 6.5
const NOTICE_MARGIN_PT = 6

/**
 * Where the visual bottom-left corner of a rotated page lies in user space, and
 * which text rotation reads left-to-right on screen there.
 */
function noticeAnchor(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): { x: number; y: number; angle: number } {
  const m = NOTICE_MARGIN_PT
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: box.x + box.width - m, y: box.y + m, angle: 90 }
    case 180:
      return { x: box.x + box.width - m, y: box.y + box.height - m, angle: 180 }
    case 270:
      return { x: box.x + m, y: box.y + box.height - m, angle: 270 }
    default:
      return { x: box.x + m, y: box.y + m, angle: 0 }
  }
}

/**
 * Makes the edited status visible in the exported copy: a small notice in the
 * visual bottom-left margin of each modified page, plus document keywords.
 * Returns the notice text drawn on each page.
 */
export async function markModifiedCopy(
  pdfDoc: PDFDocument,
  modifiedPages: ReadonlyMap<number, string>,
  documentSummary: string,
  dateLabel: string,
): Promise<Map<number, string>> {
  const existing = pdfDoc.getKeywords()
  pdfDoc.setKeywords([
    ...(existing ? [existing] : []),
    `Modified copy (SmartPDF Studio, ${dateLabel}): ${documentSummary}`,
  ])

  const drawn = new Map<number, string>()
  if (modifiedPages.size === 0) {
    return drawn
  }
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  for (const [pageIndex, pageSummary] of modifiedPages) {
    const page = pdfDoc.getPage(pageIndex)
    const anchor = noticeAnchor(page.getCropBox(), page.getRotation().angle)
    const notice = `Modified copy — ${pageSummary} (SmartPDF Studio, ${dateLabel})`
    drawn.set(pageIndex, notice)
    page.drawText(notice, {
      x: anchor.x,
      y: anchor.y,
      size: NOTICE_SIZE_PT,
      font,
      color: rgb(0.35, 0.35, 0.4),
      rotate: degrees(anchor.angle),
    })
  }
  return drawn
}
