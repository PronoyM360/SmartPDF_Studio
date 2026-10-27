import { describe, expect, it } from 'vitest'
import {
  createInitialHistoryState,
  historyCommit,
  historyRedo,
  historyUndo,
} from '@/features/pdf-editor/editorHistory'
import {
  buildTextCorrectionOverlays,
  committedAmountEdits,
  mergeTextCorrections,
  prepareTextCorrections,
  type OverlayTextCorrectionInput,
} from '@/features/pdf-editor/textCorrectionOverlays'
import { sanitizeRestoredOverlayFonts } from '@/lib/pdf/export/overlayFontResolution'
import { describeExportedModifications, summarizeModifications } from '@/lib/redaction/maskModes'
import type { OverlayObject } from '@/types/overlayObjects'
import type { TextOverlayObject } from '@/types/textOverlay'

function amountEdit(
  replacementText: string,
  replaceObjectIds: readonly string[] = [],
  targetKey = 'pdf_text:0:500:526:5784',
): OverlayTextCorrectionInput {
  return {
    pageIndex: 0,
    bounds: { x: 100, y: 520, width: 30, height: 14 },
    maskBounds: { x: 99, y: 521, width: 32, height: 13 },
    originalText: '5784',
    replacementText,
    fontSizeHint: 12,
    fontFamily: 'g_d0_f2, Arial',
    fontWeight: 'normal',
    color: '#17a34a',
    letterSpacing: 0.12,
    amendment: {
      kind: 'amount',
      targetKey,
      pageIndex: 0,
      originalText: '5784',
      replacementText,
      originalValue: 5784,
      replacementValue: Number(replacementText),
      role: 'gross_fare',
      label: 'Gross Fare',
      source: 'pdf_text',
      fontMatch: 'embedded_verified',
      fallbackFontFamily: 'Arial',
      fallbackFontWeight: 'bold',
      baselineY: 526,
    },
    replaceObjectIds,
  }
}

function textOf(objects: readonly OverlayObject[]): string[] {
  return objects.filter((object): object is TextOverlayObject => object.kind === 'text').map((object) => object.content)
}

describe('amount edit overlays', () => {
  it('links the cover mask to the replacement text and keeps style fields', () => {
    const [mask, text] = buildTextCorrectionOverlays(amountEdit('5884'))
    expect(text.amendment?.maskId).toBe(mask.id)
    expect(mask.label).toMatch(/5784/)
    expect(text).toMatchObject({ content: '5884', color: '#17a34a', letterSpacing: 0.12, fontSize: 12 })
  })

  it('supports apply, re-edit, undo and redo as single steps', () => {
    let history = createInitialHistoryState()
    const first = prepareTextCorrections([amountEdit('5884')])
    history = historyCommit(history, mergeTextCorrections(history.present, first))
    expect(textOf(history.present)).toEqual(['5884'])

    const edit = committedAmountEdits(history.present).get('pdf_text:0:500:526:5784')!
    const second = prepareTextCorrections([amountEdit('5984', [edit.textId, edit.amendment.maskId])])
    history = historyCommit(history, mergeTextCorrections(history.present, second))
    expect(history.present).toHaveLength(2)
    expect(textOf(history.present)).toEqual(['5984'])

    history = historyUndo(history)
    expect(textOf(history.present)).toEqual(['5884'])
    history = historyUndo(history)
    expect(history.present).toEqual([])
    expect(committedAmountEdits(history.present).size).toBe(0)
    history = historyRedo(history)
    expect(textOf(history.present)).toEqual(['5884'])
    history = historyRedo(history)
    expect(textOf(history.present)).toEqual(['5984'])
  })

  it('applies a reviewed set of duplicate values in one undo step', () => {
    let history = createInitialHistoryState()
    const prepared = prepareTextCorrections([
      amountEdit('5884', [], 'a'),
      amountEdit('5884', [], 'b'),
    ])
    history = historyCommit(history, mergeTextCorrections(history.present, prepared))
    expect(committedAmountEdits(history.present).size).toBe(2)
    history = historyUndo(history)
    expect(history.present).toEqual([])
  })

  it('reports amount edits separately from plain covers and text edits', () => {
    const overlays = buildTextCorrectionOverlays(amountEdit('5884'))
    const summary = summarizeModifications(overlays)
    expect(summary).toMatchObject({ amountEdits: 1, covers: 0, textEdits: 0, amountEditPages: [0] })
    expect(describeExportedModifications(summary)).toBe('1 edited amount')
  })

  it('drops PDF.js font face names from restored sessions and downgrades the match', () => {
    const [mask, text] = buildTextCorrectionOverlays(amountEdit('5884'))
    const [restoredMask, restoredText] = sanitizeRestoredOverlayFonts([mask, text]) as [OverlayObject, TextOverlayObject]
    expect(restoredMask).toBe(mask)
    expect(restoredText.fontFamily).toBe('Arial')
    expect(restoredText.fontWeight).toBe('bold')
    expect(restoredText.amendment?.fontMatch).toBe('approximate')
  })
})
