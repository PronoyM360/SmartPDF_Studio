import { describe, expect, it } from 'vitest'
import {
  createInitialHistoryState,
  historyCommit,
  historyRedo,
  historyUndo,
} from '@/features/pdf-editor/editorHistory'
import type { TextOverlayObject } from '@/types/textOverlay'

function sampleText(id: string): TextOverlayObject {
  return {
    id,
    kind: 'text',
    pageIndex: 0,
    bounds: { x: 10, y: 20, width: 100, height: 24 },
    content: 'Hello',
    fontFamily: 'Arial',
    fontSize: 14,
    color: '#000000',
    alignment: 'left',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('editorHistory', () => {
  it('commits and undoes overlay snapshots', () => {
    let state = createInitialHistoryState()
    state = historyCommit(state, [sampleText('a')])
    state = historyCommit(state, [sampleText('a'), sampleText('b')])
    expect(state.present).toHaveLength(2)

    state = historyUndo(state)
    expect(state.present).toHaveLength(1)
    expect(state.future).toHaveLength(1)

    state = historyRedo(state)
    expect(state.present).toHaveLength(2)
  })

  it('stores prior present in past on commit', () => {
    let state = createInitialHistoryState()
    state = historyCommit(state, [sampleText('a')])
    state = historyCommit(state, [sampleText('a'), sampleText('b')])
    expect(state.past).toHaveLength(2)
    expect(state.past[1]).toHaveLength(1)
  })
})
