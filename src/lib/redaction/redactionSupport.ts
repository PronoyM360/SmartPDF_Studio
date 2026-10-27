/**
 * Genuine redaction renders and flattens pages in the browser, then re-reads the
 * download to confirm the content is gone; it needs canvas rendering and encoding.
 */
export function isGenuineRedactionSupported(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const canvas = document.createElement('canvas')
  return typeof canvas.getContext === 'function' && typeof canvas.toBlob === 'function'
}
