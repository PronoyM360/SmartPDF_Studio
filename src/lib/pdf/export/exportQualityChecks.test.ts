import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { runExportQualityChecks } from '@/lib/pdf/export/exportQualityChecks'
import type { PdfSource } from '@/types'
import type { TextOverlayObject } from '@/types/textOverlay'

async function singlePageSource(): Promise<PdfSource> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const bytes = await doc.save()
  return {
    name: 'quality.pdf',
    byteLength: bytes.byteLength,
    originalBytes: bytes,
  }
}

describe('runExportQualityChecks', () => {
  it('passes core checks for a valid export with overlays', async () => {
    const source = await singlePageSource()
    const now = Date.now()
    const overlay: TextOverlayObject = {
      id: 't1',
      kind: 'text',
      pageIndex: 0,
      bounds: { x: 72, y: 700, width: 80, height: 20 },
      content: 'Test',
      fontFamily: 'Helvetica',
      fontSize: 12,
      color: '#000000',
      alignment: 'left',
      createdAt: now,
      updatedAt: now,
    }

    const report = await runExportQualityChecks({
      source,
      overlays: [overlay],
      getImageBytes: () => undefined,
      expectedPageCount: 1,
      includeRenderProbe: false,
    })

    expect(report.canDownload).toBe(true)
    expect(report.checks.find((c) => c.id === 'can_export')?.status).toBe('passed')
    expect(report.checks.find((c) => c.id === 'reopen_file')?.status).toBe('passed')
    expect(report.checks.find((c) => c.id === 'page_count')?.status).toBe('passed')
    expect(report.checks.find((c) => c.id === 'render_preview')?.status).toBe('not_checked')
  })

  it('fails when committed text overlay is empty', async () => {
    const source = await singlePageSource()
    const now = Date.now()
    const overlay: TextOverlayObject = {
      id: 't1',
      kind: 'text',
      pageIndex: 0,
      bounds: { x: 72, y: 700, width: 80, height: 20 },
      content: '   ',
      fontFamily: 'Helvetica',
      fontSize: 12,
      color: '#000000',
      alignment: 'left',
      createdAt: now,
      updatedAt: now,
    }

    const report = await runExportQualityChecks({
      source,
      overlays: [overlay],
      getImageBytes: () => undefined,
      expectedPageCount: 1,
      includeRenderProbe: false,
    })

    expect(report.canDownload).toBe(false)
    expect(report.checks.some((c) => c.status === 'failed')).toBe(true)
  })
})
