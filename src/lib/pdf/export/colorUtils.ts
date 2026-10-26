import { rgb, type RGB } from 'pdf-lib'

/** Ensures `#rrggbb` for HTML `<input type="color">` (short hex expanded). */
export function normalizeHexForColorInput(hex: string, fallback = '#000000'): string {
  const trimmed = hex.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  const body = withHash.slice(1)
  if (/^[0-9a-fA-F]{6}$/.test(body)) {
    return `#${body.toLowerCase()}`
  }
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    const expanded = body
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded.toLowerCase()}`
  }
  return fallback
}

export function hexToRgbaCss(hex: string, opacity: number): string {
  const normalized = normalizeHexForColorInput(hex, '#000000').slice(1)
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const alpha = Math.max(0, Math.min(1, opacity))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function hexToRgbColor(hex: string): RGB {
  const normalized = hex.trim().replace('#', '')
  if (normalized.length !== 6) {
    return rgb(0, 0, 0)
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255
  return rgb(r, g, b)
}
