import { idbDelete, idbGet, idbPut, STORE_PDF_FILES, type StorageResult } from '@/lib/persistence/idb'
import type { PdfSource } from '@/types'

export interface StoredPdfRecord {
  readonly name: string
  readonly bytes: ArrayBuffer
  readonly storedAt: string
}

/** Stores the original PDF once; skips rewrite if bytes already on disk. */
export async function ensurePdfStoredInIndexedDb(
  documentId: string,
  source: PdfSource,
): Promise<StorageResult<void>> {
  const existing = await loadPdfFromIndexedDb(documentId)
  if (!existing.ok) {
    return existing
  }
  if (existing.value && existing.value.byteLength === source.byteLength) {
    return { ok: true, value: undefined }
  }
  return savePdfToIndexedDb(documentId, source)
}

export async function savePdfToIndexedDb(
  documentId: string,
  source: PdfSource,
): Promise<StorageResult<void>> {
  const record: StoredPdfRecord = {
    name: source.name,
    bytes: source.originalBytes.buffer.slice(
      source.originalBytes.byteOffset,
      source.originalBytes.byteOffset + source.originalBytes.byteLength,
    ) as ArrayBuffer,
    storedAt: new Date().toISOString(),
  }
  return idbPut(STORE_PDF_FILES, documentId, record)
}

export async function loadPdfFromIndexedDb(
  documentId: string,
): Promise<StorageResult<PdfSource | null>> {
  const result = await idbGet<StoredPdfRecord>(STORE_PDF_FILES, documentId)
  if (!result.ok) {
    return result
  }
  if (!result.value) {
    return { ok: true, value: null }
  }
  const bytes = new Uint8Array(result.value.bytes)
  return {
    ok: true,
    value: {
      name: result.value.name,
      byteLength: bytes.byteLength,
      originalBytes: bytes,
    },
  }
}

export async function deletePdfFromIndexedDb(
  documentId: string,
): Promise<StorageResult<void>> {
  return idbDelete(STORE_PDF_FILES, documentId)
}
