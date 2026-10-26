import { describe, expect, it } from 'vitest'
import { createGreenPriceSamplePdf } from '@/lib/pdf/fixtures/createTextEditSamplePdf'

describe('createGreenPriceSamplePdf', () => {
  it('creates a non-empty PDF buffer for manual text-edit tests', async () => {
    const bytes = await createGreenPriceSamplePdf()
    expect(bytes.byteLength).toBeGreaterThan(500)
    expect(bytes[0]).toBe(0x25)
    expect(bytes[1]).toBe(0x50)
  })
})
