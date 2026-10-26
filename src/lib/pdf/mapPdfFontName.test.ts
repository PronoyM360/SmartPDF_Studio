import { describe, expect, it } from 'vitest'
import { mapPdfFontName } from '@/lib/pdf/mapPdfFontName'

describe('mapPdfFontName', () => {
  it('maps common PDF internal names', () => {
    expect(mapPdfFontName('Arial-BoldMT').family).toBe('Arial')
    expect(mapPdfFontName('Arial-BoldMT').weight).toBe('bold')
    expect(mapPdfFontName('TimesNewRomanPSMT').family).toBe('Times New Roman')
  })

  it('maps subset Calibri names', () => {
    const mapped = mapPdfFontName('ABCDEF+Calibri-Bold')
    expect(mapped.family).toBe('Calibri')
    expect(mapped.weight).toBe('bold')
    expect(mapped.isExactFamilyMatch).toBe(true)
  })

  it('parses US suffix families from subset names', () => {
    expect(mapPdfFontName('XYZ+GraphikUS-Bold').family).toBe('Graphik US')
    expect(mapPdfFontName('XYZ+GraphikUS-Bold').weight).toBe('bold')
  })

  it('uses CSS family name for unknown subset fonts', () => {
    const mapped = mapPdfFontName('ABCDEF+CustomFont-Bold')
    expect(mapped.isExactFamilyMatch).toBe(false)
    expect(mapped.weight).toBe('bold')
    expect(mapped.family).toBe('Custom Font')
  })
})
