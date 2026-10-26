import { describe, expect, it } from 'vitest'
import { computeSubstringMatchBounds } from '@/lib/pdf/computeSubstringMatchBounds'

describe('computeSubstringMatchBounds', () => {
  const itemBounds = { x: 0, y: 0, width: 100, height: 10 }

  it('uses full width for entire string', () => {
    const match = computeSubstringMatchBounds(itemBounds, 'abcd', 0, 4)
    expect(match.x).toBe(0)
    expect(match.width).toBe(100)
  })

  it('narrows bounds for middle substring', () => {
    const match = computeSubstringMatchBounds(itemBounds, 'abcd', 1, 3)
    expect(match.x).toBe(25)
    expect(match.width).toBe(50)
  })

  it('places second occurrence further right', () => {
    const first = computeSubstringMatchBounds(itemBounds, 'foofoo', 0, 3)
    const second = computeSubstringMatchBounds(itemBounds, 'foofoo', 3, 6)
    expect(second.x).toBeGreaterThan(first.x)
  })
})
