export function buildExportFilename(documentName: string): string {
  const base = documentName.trim().replace(/\.pdf$/i, '') || 'document'
  const safe = base.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ')
  return `${safe}-edited.pdf`
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  URL.revokeObjectURL(url)
}
