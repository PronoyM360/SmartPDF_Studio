import { describe, expect, it } from 'vitest'
import { classifyOcrTextTags } from '@/lib/ocr/classifyOcrText'

describe('classifyOcrTextTags', () => {
  it('tags common price strings', () => {
    expect(classifyOcrTextTags('$12.99')).toContain('price')
    expect(classifyOcrTextTags('USD 40')).toContain('price')
  })

  it('does not tag arbitrary sentences', () => {
    expect(classifyOcrTextTags('Invoice total due')).toEqual([])
  })
})
