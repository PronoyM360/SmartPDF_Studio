/** Some browsers cancel a download whose object URL is revoked in the same task. */
const DOWNLOAD_URL_LIFETIME_MS = 60_000

export function buildExportFilename(documentName: string): string {
  const base = documentName.trim().replace(/\.pdf$/i, '') || 'document'
  const safe = base.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ')
  const unsuffixed = safe.replace(/-edited$/i, '')
  return `${unsuffixed}-edited.pdf`
}

/** Starts a download and returns a function that revokes its object URL (idempotent). */
export function downloadPdfBytes(bytes: Uint8Array, filename: string): () => void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  let revoked = false
  const revoke = (): void => {
    if (revoked) {
      return
    }
    revoked = true
    clearTimeout(timer)
    URL.revokeObjectURL(url)
  }
  const timer = setTimeout(revoke, DOWNLOAD_URL_LIFETIME_MS)
  return revoke
}
