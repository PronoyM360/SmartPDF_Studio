import { describe, expect, it } from 'vitest'
import { clampPageRect } from '@/lib/pdf/clampPageRect'

const page = { width: 612, height: 792 }

describe('clampPageRect', () => {
  it('clamps position inside the page', () => {
    const result = clampPageRect(
      { x: 600, y: 780, width: 40, height: 30 },
      page,
    )
    expect(result.x).toBeLessThanOrEqual(612 - result.width)
    expect(result.y).toBeLessThanOrEqual(792 - result.height)
  })

  it('limits width to page width', () => {
    const result = clampPageRect({ x: 0, y: 0, width: 900, height: 20 }, page)
    expect(result.width).toBe(612)
  })
})
