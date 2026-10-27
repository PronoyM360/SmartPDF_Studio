import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib'
import type { PageRect } from '@/types'

/** Page-dictionary entries that can carry the page's original content or text. */
const PAGE_KEYS_TO_DROP = [
  'Contents',
  'Annots',
  'Thumb',
  'PieceInfo',
  'Metadata',
  'StructParents',
  'Group',
  'AA',
  'B',
] as const

export interface FlattenedPageInput {
  readonly pageIndex: number
  /** PNG of the page's visible area (unrotated user space) with redactions burned in. */
  readonly png: Uint8Array
  /** Visible area in PDF user space the image must cover (PDF.js `page.view`). */
  readonly visibleBox: PageRect
}

/**
 * Replaces each page's content with a single image. Page boxes and /Rotate are kept,
 * so dimensions and layout are unchanged. Returns widget refs removed with /Annots.
 */
export async function flattenPagesToImages(
  pdfDoc: PDFDocument,
  pages: readonly FlattenedPageInput[],
): Promise<Set<string>> {
  const removedAnnotRefs = new Set<string>()
  for (const input of pages) {
    const page = pdfDoc.getPage(input.pageIndex)
    const node = page.node

    const annots = node.lookup(PDFName.of('Annots'))
    if (annots instanceof PDFArray) {
      for (let index = 0; index < annots.size(); index += 1) {
        const entry = annots.get(index)
        if (entry instanceof PDFRef) {
          removedAnnotRefs.add(entry.toString())
        }
      }
    }

    for (const key of PAGE_KEYS_TO_DROP) {
      node.delete(PDFName.of(key))
    }
    node.set(PDFName.of('Resources'), pdfDoc.context.obj({}))

    const image = await pdfDoc.embedPng(input.png)
    page.drawImage(image, {
      x: input.visibleBox.x,
      y: input.visibleBox.y,
      width: input.visibleBox.width,
      height: input.visibleBox.height,
    })
  }
  return removedAnnotRefs
}

/**
 * Removes AcroForm fields whose widgets lived on flattened pages; otherwise their
 * values (e.g. a filled-in email) would survive in /AcroForm /Fields.
 */
export function removeFormFieldsForWidgets(
  pdfDoc: PDFDocument,
  removedWidgetRefs: ReadonlySet<string>,
): number {
  if (removedWidgetRefs.size === 0) {
    return 0
  }
  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'))
  if (!(acroForm instanceof PDFDict)) {
    return 0
  }
  const fields = acroForm.lookup(PDFName.of('Fields'))
  if (!(fields instanceof PDFArray)) {
    return 0
  }

  let removed = 0
  const prune = (array: PDFArray): void => {
    for (let index = array.size() - 1; index >= 0; index -= 1) {
      const entry = array.get(index)
      if (!(entry instanceof PDFRef)) {
        continue
      }
      if (removedWidgetRefs.has(entry.toString())) {
        array.remove(index)
        removed += 1
        continue
      }
      const field = pdfDoc.context.lookup(entry)
      if (!(field instanceof PDFDict)) {
        continue
      }
      const kids = field.lookup(PDFName.of('Kids'))
      if (kids instanceof PDFArray) {
        prune(kids)
        if (kids.size() === 0) {
          array.remove(index)
          removed += 1
        }
      }
    }
  }
  prune(fields)
  return removed
}

/**
 * Tagged-PDF structure can repeat page text in /ActualText or /Alt. Once a page is
 * flattened its marked content is gone anyway, so the tree is dropped.
 */
export function removeStructureTree(pdfDoc: PDFDocument): boolean {
  const had = pdfDoc.catalog.has(PDFName.of('StructTreeRoot'))
  pdfDoc.catalog.delete(PDFName.of('StructTreeRoot'))
  if (had) {
    pdfDoc.catalog.delete(PDFName.of('MarkInfo'))
  }
  return had
}

function collectRefs(object: PDFObject | undefined, visit: (ref: PDFRef) => void): void {
  if (!object) {
    return
  }
  if (object instanceof PDFRef) {
    visit(object)
    return
  }
  if (object instanceof PDFDict) {
    for (const [, value] of object.entries()) {
      collectRefs(value, visit)
    }
    return
  }
  if (object instanceof PDFArray) {
    for (let index = 0; index < object.size(); index += 1) {
      collectRefs(object.get(index), visit)
    }
    return
  }
  if (object instanceof PDFStream) {
    collectRefs(object.dict, visit)
  }
}

/**
 * pdf-lib writes every indirect object in its context on save, including ones no
 * longer referenced (the old content stream, original object streams). Deleting
 * everything unreachable from the trailer keeps replaced content out of the file.
 */
export function pruneUnreachableObjects(pdfDoc: PDFDocument): number {
  const context = pdfDoc.context
  const reachable = new Set<string>()
  const stack: PDFRef[] = []
  const visit = (ref: PDFRef): void => {
    const key = ref.toString()
    if (!reachable.has(key)) {
      reachable.add(key)
      stack.push(ref)
    }
  }

  const trailer = context.trailerInfo
  for (const root of [trailer.Root, trailer.Info, trailer.Encrypt, trailer.ID]) {
    collectRefs(root, visit)
  }

  while (stack.length > 0) {
    const ref = stack.pop()!
    collectRefs(context.lookup(ref), visit)
  }

  let deleted = 0
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref)
      deleted += 1
    }
  }
  return deleted
}
