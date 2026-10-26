export function sampleColorFromPdfCanvas(
  pageNumber: number,
  clientX: number,
  clientY: number,
): string | null {
  const canvas = document.querySelector(
    `canvas[aria-label="PDF page ${pageNumber}"]`,
  )
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null
  }

  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const relativeX = (clientX - rect.left) / rect.width
  const relativeY = (clientY - rect.top) / rect.height
  if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) {
    return null
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  const pixelX = Math.min(
    canvas.width - 1,
    Math.max(0, Math.floor(relativeX * canvas.width)),
  )
  const pixelY = Math.min(
    canvas.height - 1,
    Math.max(0, Math.floor(relativeY * canvas.height)),
  )

  try {
    const data = context.getImageData(pixelX, pixelY, 1, 1).data
    const r = data[0] ?? 255
    const g = data[1] ?? 255
    const b = data[2] ?? 255
    const toHex = (value: number): string => value.toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  } catch {
    return null
  }
}
