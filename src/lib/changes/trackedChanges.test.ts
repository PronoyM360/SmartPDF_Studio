import { describe, expect, it } from 'vitest'
import {
  createInitialHistoryState,
  historyCommit,
  historyRedo,
  historyUndo,
} from '@/features/pdf-editor/editorHistory'
import {
  buildTextCorrectionOverlays,
  createMaskObject,
} from '@/features/pdf-editor/textCorrectionOverlays'
import { buildTrackedChanges, countTrackedChanges } from '@/lib/changes/trackedChanges'
import type { OverlayObject } from '@/types/overlayObjects'

const box = { x: 100, y: 500, width: 40, height: 12 }

function textReplacement(pageIndex: number): OverlayObject[] {
  return buildTextCorrectionOverlays({
    pageIndex,
    bounds: box,
    originalText: 'Invoice 2025',
    replacementText: 'Invoice 2026',
    editSource: 'pdf_text',
  })
}

function priceEdit(pageIndex: number): OverlayObject[] {
  return buildTextCorrectionOverlays({
    pageIndex,
    bounds: box,
    originalText: '12.50',
    replacementText: '14.00',
    alignment: 'right',
    amendment: {
      kind: 'amount',
      targetKey: 'p0:12.50',
      pageIndex,
      originalText: '12.50',
      replacementText: '14.00',
      originalValue: 12.5,
      replacementValue: 14,
      role: 'line_item',
      label: 'Adult fare',
      source: 'pdf_text',
      fontMatch: 'approximate',
      fallbackFontFamily: 'Arial',
      fallbackFontWeight: 'normal',
      baselineY: 503,
    },
  })
}

function ocrEdit(pageIndex: number): OverlayObject[] {
  return buildTextCorrectionOverlays({
    pageIndex,
    bounds: box,
    originalText: '16.75',
    replacementText: '18.40',
    maskBackgroundPatch: { assetId: 'patch', method: 'inpaint', backgroundKind: 'textured' },
    ocrEdit: { recognizedText: '1675', confidence: 80, backgroundKind: 'textured', repairMethod: 'inpaint' },
    editSource: 'ocr',
  })
}

describe('buildTrackedChanges', () => {
  it('describes each kind of edit with its before and after text', () => {
    const overlays = [
      ...textReplacement(0),
      ...priceEdit(0),
      ...ocrEdit(1),
      createMaskObject(2, box, '#ffffff', 1, { mode: 'hide', label: 'Terms and conditions', sourceSectionId: 's1' }),
      createMaskObject(2, box, '#000000', 1, { mode: 'redact', label: 'Account number' }),
      createMaskObject(3, box),
    ]
    const changes = buildTrackedChanges(overlays)

    expect(changes.map((change) => [change.pageIndex, change.kind, change.title])).toEqual([
      [0, 'text-replaced', 'Text replaced'],
      [0, 'price-updated', 'Price updated'],
      [1, 'ocr-edit', 'Scanned text edited (OCR)'],
      [2, 'section', 'Section hidden'],
      [2, 'area', 'Area redacted'],
      [3, 'area', 'Area covered'],
    ])
    expect(changes[0]).toMatchObject({ before: 'Invoice 2025', after: 'Invoice 2026', inExport: true })
    expect(changes[1]).toMatchObject({ before: '12.50', after: '14.00' })
    expect(changes[2]).toMatchObject({ before: '16.75', after: '18.40' })
    expect(changes[3]).toMatchObject({ label: 'Terms and conditions', maskMode: 'hide', inExport: false })
  })

  it('groups each text edit with its own cover mask', () => {
    const [mask, text] = priceEdit(0)
    const [change] = buildTrackedChanges([mask!, text!])
    expect(change?.objectIds).toEqual([text!.id, mask!.id])
    expect(change?.bounds.width).toBeGreaterThanOrEqual(text!.bounds.width)
  })

  it('counts changes across pages of different sizes', () => {
    const changes = buildTrackedChanges([...textReplacement(0), ...ocrEdit(4), createMaskObject(4, box, '#fff', 1, { mode: 'hide' })])
    const counts = countTrackedChanges(changes)
    expect(counts).toMatchObject({ total: 3, inExport: 2, pages: [1, 5] })
    expect(counts.byKind['ocr-edit']).toBe(1)
    expect(counts.byKind.area).toBe(1)
  })

  it('follows undo and redo of committed edits', () => {
    let history = createInitialHistoryState()
    history = historyCommit(history, textReplacement(0))
    history = historyCommit(history, [...history.present, ...priceEdit(1)])
    expect(buildTrackedChanges(history.present).map((change) => change.kind)).toEqual([
      'text-replaced',
      'price-updated',
    ])
    history = historyUndo(history)
    expect(buildTrackedChanges(history.present).map((change) => change.kind)).toEqual(['text-replaced'])
    history = historyUndo(history)
    expect(buildTrackedChanges(history.present)).toEqual([])
    history = historyRedo(historyRedo(history))
    expect(countTrackedChanges(buildTrackedChanges(history.present)).total).toBe(2)
  })
})
