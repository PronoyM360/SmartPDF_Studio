import { describe, expect, it } from 'vitest'
import { ocrConfidenceLabel, ocrConfidenceTier } from '@/lib/ocr/ocrConfidence'

describe('ocrConfidenceTier', () => {
  it('classifies low-resolution uncertain reads', () => {
    expect(ocrConfidenceTier(42)).toBe('low')
  })

  it('classifies small price-like high confidence', () => {
    expect(ocrConfidenceTier(88)).toBe('high')
  })

  it('labels results as estimates', () => {
    expect(ocrConfidenceLabel(72)).toContain('Estimate')
  })
})
