import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib'
import { pageRectsIntersect } from '@/lib/pdf/pageRectIntersect'
import { maskModeOf } from '@/lib/redaction/maskModes'
import type { PageRect } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'

export interface PageAnnotationInfo {
  readonly subtype: string
  readonly rect: PageRect
}

export interface DocumentFeatures {
  readonly encrypted: boolean
  readonly signedFieldCount: number
  readonly formFieldCount: number
  readonly hasXfa: boolean
  readonly tagged: boolean
  readonly hasXmpMetadata: boolean
  readonly claimsPdfA: boolean
  /** Approximate: counted from `%%EOF` markers, minus one for linearization. */
  readonly incrementalUpdates: number
  readonly hasOptionalContent: boolean
  readonly hasEmbeddedFiles: boolean
  readonly annotationsByPage: readonly (readonly PageAnnotationInfo[])[]
  readonly imageCountByPage: readonly number[]
}

function countMarker(bytes: Uint8Array, marker: string): number {
  const codes = [...marker].map((char) => char.charCodeAt(0))
  let count = 0
  outer: for (let index = 0; index + codes.length <= bytes.length; index += 1) {
    for (let offset = 0; offset < codes.length; offset += 1) {
      if (bytes[index + offset] !== codes[offset]) {
        continue outer
      }
    }
    count += 1
  }
  return count
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes)
}

function readRect(value: PDFObject | undefined): PageRect | null {
  if (!(value instanceof PDFArray) || value.size() < 4) {
    return null
  }
  const numbers = value.asArray().map((entry) => (entry instanceof PDFNumber ? entry.asNumber() : Number.NaN))
  if (numbers.some((entry) => !Number.isFinite(entry))) {
    return null
  }
  const [x0, y0, x1, y1] = numbers as [number, number, number, number]
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
}

function walkFields(
  doc: PDFDocument,
  fields: PDFArray,
  inheritedType: string | null,
  visit: (field: PDFDict, type: string | null) => void,
  seen: Set<PDFDict>,
): void {
  for (const entry of fields.asArray()) {
    const field = entry instanceof PDFRef ? doc.context.lookup(entry) : entry
    if (!(field instanceof PDFDict) || seen.has(field)) {
      continue
    }
    seen.add(field)
    const own = field.get(PDFName.of('FT'))
    const type = own instanceof PDFName ? own.decodeText() : inheritedType
    const kids = field.lookup(PDFName.of('Kids'))
    // Kids without a /T are widget annotations of this field, not child fields.
    const childFields =
      kids instanceof PDFArray &&
      kids.asArray().some((kid) => {
        const resolved = kid instanceof PDFRef ? doc.context.lookup(kid) : kid
        return resolved instanceof PDFDict && resolved.has(PDFName.of('T'))
      })
    if (childFields && kids instanceof PDFArray) {
      walkFields(doc, kids, type, visit, seen)
    } else if (field.has(PDFName.of('T'))) {
      visit(field, type)
    }
  }
}

function pageImageCount(doc: PDFDocument, pageIndex: number): number {
  const resources = doc.getPage(pageIndex).node.Resources()
  const xobjects = resources?.lookup(PDFName.of('XObject'))
  if (!(xobjects instanceof PDFDict)) {
    return 0
  }
  let count = 0
  for (const [, value] of xobjects.entries()) {
    const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value
    if (resolved instanceof PDFStream && resolved.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      count += 1
    }
  }
  return count
}

/** Read-only scan of a loaded document; nothing is created or changed. */
export function readDocumentFeatures(doc: PDFDocument, originalBytes: Uint8Array): DocumentFeatures {
  const catalog = doc.catalog
  const acroForm = catalog.lookup(PDFName.of('AcroForm'))
  let formFieldCount = 0
  let signedFieldCount = 0
  let hasXfa = false
  if (acroForm instanceof PDFDict) {
    hasXfa = acroForm.has(PDFName.of('XFA'))
    const fields = acroForm.lookup(PDFName.of('Fields'))
    if (fields instanceof PDFArray) {
      walkFields(
        doc,
        fields,
        null,
        (field, type) => {
          formFieldCount += 1
          if (type === 'Sig' && field.has(PDFName.of('V'))) {
            signedFieldCount += 1
          }
        },
        new Set(),
      )
    }
  }
  if (signedFieldCount === 0 && catalog.has(PDFName.of('Perms'))) {
    signedFieldCount = 1
  }

  let hasXmpMetadata = false
  let claimsPdfA = false
  const metadata = catalog.lookup(PDFName.of('Metadata'))
  if (metadata instanceof PDFRawStream) {
    hasXmpMetadata = true
    try {
      claimsPdfA = /pdfaid:part/i.test(latin1(decodePDFRawStream(metadata).decode()))
    } catch {
      claimsPdfA = false
    }
  }

  const markInfo = catalog.lookup(PDFName.of('MarkInfo'))
  const tagged =
    catalog.has(PDFName.of('StructTreeRoot')) ||
    (markInfo instanceof PDFDict && String(markInfo.get(PDFName.of('Marked'))) === 'true')

  const names = catalog.lookup(PDFName.of('Names'))
  const hasEmbeddedFiles = names instanceof PDFDict && names.has(PDFName.of('EmbeddedFiles'))

  const linearized = /\/Linearized/.test(latin1(originalBytes.subarray(0, 2048)))
  const eofCount = countMarker(originalBytes, '%%EOF')
  const incrementalUpdates = Math.max(0, eofCount - 1 - (linearized ? 1 : 0))

  const annotationsByPage: PageAnnotationInfo[][] = []
  const imageCountByPage: number[] = []
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex += 1) {
    const list: PageAnnotationInfo[] = []
    const annots = doc.getPage(pageIndex).node.Annots()
    for (const entry of annots instanceof PDFArray ? annots.asArray() : []) {
      const annot = entry instanceof PDFRef ? doc.context.lookup(entry) : entry
      if (!(annot instanceof PDFDict)) {
        continue
      }
      const subtype = annot.get(PDFName.of('Subtype'))
      const rect = readRect(annot.lookup(PDFName.of('Rect')))
      if (rect) {
        list.push({ subtype: subtype instanceof PDFName ? subtype.decodeText() : 'Unknown', rect })
      }
    }
    annotationsByPage.push(list)
    imageCountByPage.push(pageImageCount(doc, pageIndex))
  }

  return {
    encrypted: doc.isEncrypted,
    signedFieldCount,
    formFieldCount,
    hasXfa,
    tagged,
    hasXmpMetadata,
    claimsPdfA,
    incrementalUpdates,
    hasOptionalContent: catalog.has(PDFName.of('OCProperties')),
    hasEmbeddedFiles,
    annotationsByPage,
    imageCountByPage,
  }
}

function pageList(indices: Iterable<number>): string {
  return [...new Set(indices)].sort((a, b) => a - b).map((index) => index + 1).join(', ')
}

/** Plain-language warnings about what this document's structure means for the edited copy. */
export function documentFeatureWarnings(
  features: DocumentFeatures,
  operations: readonly OverlayObject[],
): string[] {
  const warnings: string[] = []
  const hasContentEdits = operations.some((object) => object.kind !== 'annotation')
  const covers = operations.filter(
    (object) => object.kind === 'mask' && maskModeOf(object) === 'cover',
  )
  const contentEdits = operations.filter(
    (object) => object.kind !== 'annotation' && !(object.kind === 'mask' && maskModeOf(object) === 'redact'),
  )

  if (features.signedFieldCount > 0) {
    warnings.push(
      `This PDF carries ${features.signedFieldCount} digital signature(s). Saving an edited copy rewrites the file, so those signatures will no longer validate. Do not present the copy as signed.`,
    )
  }
  if (features.incrementalUpdates > 0) {
    warnings.push(
      `The original contains about ${features.incrementalUpdates} incremental update(s) (earlier revisions). The copy is saved as a single revision; older revisions are not kept.`,
    )
  }
  if (features.hasXfa) {
    warnings.push(
      'This PDF contains an XFA form. pdf-lib does not edit XFA data; viewers that render XFA may show the original form instead of your edits.',
    )
  } else if (features.formFieldCount > 0) {
    warnings.push(
      `${features.formFieldCount} form field(s) are kept as they are. Viewers draw form fields above page content, so covers and text edits cannot hide a field's value.`,
    )
  }

  const overlapped = new Map<number, Set<string>>()
  for (const object of contentEdits) {
    for (const annotation of features.annotationsByPage[object.pageIndex] ?? []) {
      if (annotation.subtype === 'Popup' || !pageRectsIntersect(annotation.rect, object.bounds)) {
        continue
      }
      const set = overlapped.get(object.pageIndex) ?? new Set<string>()
      set.add(annotation.subtype)
      overlapped.set(object.pageIndex, set)
    }
  }
  if (overlapped.size > 0) {
    const kinds = [...new Set([...overlapped.values()].flatMap((set) => [...set]))].join(', ')
    warnings.push(
      `An edit on page ${pageList(overlapped.keys())} overlaps existing annotation(s) (${kinds}). Annotations are drawn above page content, so the edit does not hide them.`,
    )
  }

  const imagePages = contentEdits
    .filter((object) => (features.imageCountByPage[object.pageIndex] ?? 0) > 0)
    .map((object) => object.pageIndex)
  if (imagePages.length > 0) {
    warnings.push(
      `Page ${pageList(imagePages)} contains embedded image(s). Edits are drawn on top; the original image data — including any price or text printed in it — stays in the file and can be extracted.`,
    )
  }

  if (features.tagged && (covers.length > 0 || operations.some((object) => object.kind === 'text'))) {
    warnings.push(
      'This is a tagged (accessible) PDF. Its structure tree is not updated, so screen readers and "copy text" may still return the original wording under covers.',
    )
  }
  if (features.claimsPdfA && hasContentEdits) {
    warnings.push(
      'The original declares PDF/A conformance. The copy is not re-validated and likely no longer conforms (for example, standard fonts are not embedded).',
    )
  }
  if (features.hasXmpMetadata) {
    warnings.push(
      'The XMP metadata stream is copied unchanged; viewers that read XMP may still show the original producer and dates. The document info dictionary records the modification.',
    )
  }
  if (features.hasOptionalContent && hasContentEdits) {
    warnings.push(
      'This PDF has layers (optional content). Edits are drawn outside any layer and are always visible; content in hidden layers is not covered.',
    )
  }
  if (features.hasEmbeddedFiles && covers.length > 0) {
    warnings.push('Attached files are kept unchanged and may still contain information hidden by covers.')
  }
  return warnings
}
