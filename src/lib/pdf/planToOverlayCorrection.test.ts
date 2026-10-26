import { describe, expect, it } from 'vitest'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'

const samplePlan: TextReplacementPlan = {
  maskBounds: { x: 98, y: 198, width: 40, height: 16 },
  textBounds: { x: 100, y: 200, width: 36, height: 14 },
  fontFamily: 'Helvetica',
  fontSize: 12,
  fontWeight: 'bold',
  color: '#16a34a',
  alignment: 'left',
  maskFillColor: '#ffffff',
  maskOpacity: 1,
  fidelityStatus: 'approximate_font_match',
  fidelityNotes: [],
}

describe('planToOverlayCorrectionInput', () => {
  it('maps plan fields to the same commit payload export uses', () => {
    const input = planToOverlayCorrectionInput({
      pageIndex: 0,
      originalText: '5784',
      replacementText: '5884',
      plan: samplePlan,
    })
    expect(input.bounds).toEqual(samplePlan.textBounds)
    expect(input.maskBounds).toEqual(samplePlan.maskBounds)
    expect(input.fontSizeHint).toBe(12)
    expect(input.color).toBe('#16a34a')
    expect(input.replacementText).toBe('5884')
  })
})
