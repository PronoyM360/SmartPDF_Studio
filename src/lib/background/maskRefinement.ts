import type { PageRect } from '@/types'

export function expandPageRect(rect: PageRect, padding: number): PageRect {
  return {
    x: Math.max(0, rect.x - padding),
    y: Math.max(0, rect.y - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

export function shrinkPageRect(rect: PageRect, padding: number): PageRect {
  const width = Math.max(8, rect.width - padding * 2)
  const height = Math.max(8, rect.height - padding * 2)
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width,
    height,
  }
}

export const MASK_COLOR_PRESETS = [
  '#ffffff',
  '#f8fafc',
  '#fef3c7',
  '#e2e8f0',
  '#0f172a',
] as const
