export function formatLastSavedAt(iso: string | null): string | null {
  if (!iso) {
    return null
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const now = Date.now()
  const diffMs = now - date.getTime()
  if (diffMs < 60_000) {
    return 'just now'
  }
  if (diffMs < 3_600_000) {
    const minutes = Math.round(diffMs / 60_000)
    return `${minutes} min ago`
  }
  if (diffMs < 86_400_000) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
