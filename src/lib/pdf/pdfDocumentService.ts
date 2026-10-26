import type { LoadedPdfDocument, PdfSource } from '@/types'
import { openPdfDocument, releasePdfDocument } from './openPdfDocument'
import { validatePdfFile } from './validatePdfFile'

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice()
}

export async function createPdfSourceFromFile(file: File): Promise<PdfSource> {
  await validatePdfFile(file)
  const buffer = await file.arrayBuffer()
  const originalBytes = new Uint8Array(buffer)
  return {
    name: file.name,
    byteLength: originalBytes.byteLength,
    originalBytes,
  }
}

export async function inspectPdfDocument(
  source: PdfSource,
): Promise<LoadedPdfDocument> {
  const { pdf, pageCount } = await openPdfDocument(source.originalBytes)
  try {
    return {
      id: crypto.randomUUID(),
      source,
      pageCount,
      pages: [],
    }
  } finally {
    await releasePdfDocument(pdf)
  }
}

export function clonePdfSource(source: PdfSource): PdfSource {
  return {
    name: source.name,
    byteLength: source.byteLength,
    originalBytes: cloneBytes(source.originalBytes),
  }
}
