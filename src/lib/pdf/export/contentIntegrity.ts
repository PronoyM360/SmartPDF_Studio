import {
  decodePDFRawStream,
  PDFArray,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib'

export interface PageContentRecord {
  readonly pageIndex: number
  /** Digest of each content stream's raw (still encoded) bytes, in drawing order. */
  readonly streams: readonly string[]
  readonly annotationCount: number
}

/**
 * identical — same content streams, nothing added (untouched page).
 * preserved — original streams kept byte-for-byte, new drawing added around them.
 * replaced  — page was intentionally flattened (redaction).
 * changed   — original streams are missing or an untouched page was altered.
 */
export type PageContentStatus = 'identical' | 'preserved' | 'replaced' | 'changed'

export interface PageContentComparison {
  readonly pageIndex: number
  readonly status: PageContentStatus
  readonly addedStreamCount: number
  readonly annotationsBefore: number
  readonly annotationsAfter: number
}

export interface ContentIntegrityResult {
  readonly ok: boolean
  readonly pages: readonly PageContentComparison[]
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

function fnv1a(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** Non-cryptographic fingerprint; only used to recognise unchanged streams. */
export function digestBytes(bytes: Uint8Array): string {
  const a = fnv1a(bytes, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a(bytes, 0x01000193 ^ bytes.length).toString(16).padStart(8, '0')
  return `${bytes.length.toString(16)}:${a}${b}`
}

function streamBytes(stream: PDFStream): Uint8Array {
  return stream instanceof PDFRawStream ? stream.contents : stream.getContents()
}

function pageStreams(doc: PDFDocument, page: PDFPage): PDFStream[] {
  const contents = page.node.Contents()
  const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  const streams: PDFStream[] = []
  for (const entry of entries) {
    const resolved = entry instanceof PDFRef ? doc.context.lookup(entry) : entry
    if (resolved instanceof PDFStream) {
      streams.push(resolved)
    }
  }
  return streams
}

export function readPageContentRecords(doc: PDFDocument): PageContentRecord[] {
  return doc.getPages().map((page, pageIndex) => {
    const annots = page.node.Annots()
    return {
      pageIndex,
      streams: pageStreams(doc, page).map((stream) => digestBytes(streamBytes(stream))),
      annotationCount: annots instanceof PDFArray ? annots.size() : 0,
    }
  })
}

function indexOfSequence(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) {
    return 0
  }
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((value, offset) => haystack[start + offset] === value)) {
      return start
    }
  }
  return -1
}

export function compareContentRecords(
  source: readonly PageContentRecord[],
  exported: readonly PageContentRecord[],
  options: { editedPages: ReadonlySet<number>; flattenedPages: ReadonlySet<number> },
): ContentIntegrityResult {
  const errors: string[] = []
  const warnings: string[] = []
  const pages: PageContentComparison[] = []

  if (source.length !== exported.length) {
    errors.push(`Page count differs (${source.length} → ${exported.length}); content cannot be matched page by page.`)
  }

  for (let pageIndex = 0; pageIndex < Math.min(source.length, exported.length); pageIndex += 1) {
    const before = source[pageIndex]!
    const after = exported[pageIndex]!
    const edited = options.editedPages.has(pageIndex)
    const base = {
      pageIndex,
      annotationsBefore: before.annotationCount,
      annotationsAfter: after.annotationCount,
    }

    if (options.flattenedPages.has(pageIndex)) {
      pages.push({ ...base, status: 'replaced', addedStreamCount: after.streams.length })
      continue
    }

    const identical =
      before.streams.length === after.streams.length &&
      before.streams.every((value, index) => after.streams[index] === value)
    const found = indexOfSequence(after.streams, before.streams) >= 0
    const status: PageContentStatus = identical ? 'identical' : found ? 'preserved' : 'changed'
    pages.push({ ...base, status, addedStreamCount: after.streams.length - before.streams.length })

    if (status === 'changed') {
      errors.push(`Original content of page ${pageIndex + 1} was not found unchanged in the export.`)
    } else if (!edited && status !== 'identical') {
      errors.push(`Page ${pageIndex + 1} had no edits but its content streams changed.`)
    }
    if (after.annotationCount < before.annotationCount) {
      errors.push(
        `Page ${pageIndex + 1} lost ${before.annotationCount - after.annotationCount} annotation(s) or link(s).`,
      )
    } else if (!edited && after.annotationCount !== before.annotationCount) {
      warnings.push(`Page ${pageIndex + 1} has a different number of annotations although it had no edits.`)
    }
  }

  if (errors.length > 0 && source.length > 0 && exported.length > 0) {
    // A content mismatch on many pages usually means pages were reordered.
    const exportedFirst = new Map(exported.map((record) => [record.streams.join('|'), record.pageIndex]))
    const moved = source.filter((record) => {
      const at = exportedFirst.get(record.streams.join('|'))
      return record.streams.length > 0 && at !== undefined && at !== record.pageIndex
    })
    if (moved.length > 0) {
      errors.push(`Page order changed: original page ${moved[0]!.pageIndex + 1} appears at a different position.`)
    }
  }

  return { ok: errors.length === 0, pages, errors, warnings }
}

const STROKE_OPERATOR = /(?:^|\s)(?:S|s|B\*?|b\*?)(?=\s|$)/g

/**
 * Counts stroke-painting operators in the content streams the export added to each
 * page. Overlays only fill shapes, draw text and place images; selection outlines,
 * handles and guides would be strokes, so any stroke here is unexpected.
 */
export function countAddedStrokeOperators(
  exportedDoc: PDFDocument,
  source: readonly PageContentRecord[],
  pageIndices: Iterable<number>,
): number {
  let strokes = 0
  for (const pageIndex of pageIndices) {
    if (pageIndex >= exportedDoc.getPageCount()) {
      continue
    }
    const original = new Set(source[pageIndex]?.streams ?? [])
    for (const stream of pageStreams(exportedDoc, exportedDoc.getPage(pageIndex))) {
      if (original.has(digestBytes(streamBytes(stream)))) {
        continue
      }
      let text: string
      try {
        const decoded =
          stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents()
        text = new TextDecoder('latin1').decode(decoded)
      } catch {
        continue
      }
      // Strings and inline image data could contain operator-like bytes.
      const operators = text.replace(/<[^<>]*>/g, ' ').replace(/\((?:\\.|[^\\)])*\)/g, ' ')
      strokes += operators.match(STROKE_OPERATOR)?.length ?? 0
    }
  }
  return strokes
}
