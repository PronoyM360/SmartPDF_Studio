import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
  type PDFObject,
} from 'pdf-lib'

/** Shorter strings match unrelated bytes too often to be meaningful. */
export const MIN_NEEDLE_LENGTH = 4

export type LeakLocation = 'page_content' | 'metadata' | 'string_object' | 'other_stream'

export interface TextLeak {
  readonly needle: string
  readonly location: LeakLocation
}

function latin1(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    out += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return out
}

function hexOf(text: string): string {
  return [...text]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
}

function utf16HexOf(text: string): string {
  return [...text]
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
}

/** Encodings a string can take inside a PDF stream or string object. */
function needleVariants(needle: string): string[] {
  const hex = hexOf(needle)
  const utf16 = utf16HexOf(needle)
  const utf16Bytes = [...needle].map((char) => `\u0000${char}`).join('')
  return [needle, hex, hex.toUpperCase(), utf16, utf16.toUpperCase(), utf16Bytes]
}

function streamText(stream: PDFRawStream): string {
  try {
    return latin1(decodePDFRawStream(stream).decode())
  } catch {
    return latin1(stream.contents)
  }
}

const BINARY_SUBTYPES = new Set(['/Image', '/Type1C', '/CIDFontType0C', '/OpenType'])

/** null = binary data (images, font programs, ICC profiles) where text matches would be noise. */
function classifyStream(stream: PDFRawStream): LeakLocation | null {
  const dict = stream.dict
  const type = dict.lookup(PDFName.of('Type'))
  const subtype = dict.lookup(PDFName.of('Subtype'))
  if (subtype instanceof PDFName && BINARY_SUBTYPES.has(subtype.toString())) {
    return null
  }
  if (
    dict.has(PDFName.of('Length1')) ||
    dict.has(PDFName.of('Length2')) ||
    dict.has(PDFName.of('N'))
  ) {
    return null
  }
  if (type === PDFName.of('Metadata') || subtype === PDFName.of('XML')) {
    return 'metadata'
  }
  if (!type && !subtype) {
    return 'page_content'
  }
  return 'other_stream'
}

/**
 * Searches every indirect object of a saved PDF — decoded streams and string
 * objects — for the given strings. Text split across kerning arrays or encoded
 * through custom font encodings will not match, so a clean result is evidence,
 * not proof; it is combined with the PDF.js text-layer check.
 */
export async function scanPdfForText(
  bytes: Uint8Array,
  needles: readonly string[],
): Promise<TextLeak[]> {
  const usable = [...new Set(needles.map((needle) => needle.trim()))].filter(
    (needle) => needle.length >= MIN_NEEDLE_LENGTH,
  )
  if (usable.length === 0) {
    return []
  }
  const doc = await PDFDocument.load(bytes.slice(), {
    ignoreEncryption: true,
    updateMetadata: false,
  })
  const variants = usable.map((needle) => ({
    needle,
    forms: needleVariants(needle).map((form) => form.toLowerCase()),
  }))

  const leaks: TextLeak[] = []
  const seen = new Set<string>()
  const record = (needle: string, location: LeakLocation): void => {
    const key = `${needle}|${location}`
    if (!seen.has(key)) {
      seen.add(key)
      leaks.push({ needle, location })
    }
  }
  const check = (haystack: string, location: LeakLocation): void => {
    const lower = haystack.toLowerCase()
    for (const entry of variants) {
      if (entry.forms.some((form) => lower.includes(form))) {
        record(entry.needle, location)
      }
    }
  }

  const visitStrings = (object: PDFObject | undefined): void => {
    if (!object) {
      return
    }
    if (object instanceof PDFString || object instanceof PDFHexString) {
      check(object.decodeText(), 'string_object')
      return
    }
    if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) {
        visitStrings(value)
      }
      return
    }
    if (object instanceof PDFArray) {
      for (const value of object.asArray()) {
        visitStrings(value)
      }
    }
  }

  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      const location = classifyStream(object)
      if (location) {
        check(streamText(object), location)
      }
      visitStrings(object.dict)
      continue
    }
    visitStrings(object)
  }
  return leaks
}
