import { describe, expect, it } from 'vitest'
import {
  cloneOverlayObjects,
  createInitialHistoryState,
  historyCommit,
  historyUndo,
} from '@/features/pdf-editor/editorHistory'
import type { TextOverlayObject } from '@/types/textOverlay'

function text(content: string): TextOverlayObject {
  return {
    id: 't1',
    kind: 'text',
    pageIndex: 0,
    bounds: { x: 0, y: 0, width: 100, height: 24 },
    content,
    fontFamily: 'Arial',
    fontSize: 12,
    color: '#000',
    alignment: 'left',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('overlay property history batching', () => {
  it('undoes a committed property edit as one step', () => {
    let state = createInitialHistoryState()
    state = historyCommit(state, [text('Hello')])

    const baseline = cloneOverlayObjects(state.present)
    const liveEdited = [text('Hello world')]
    state = {
      past: [...state.past, baseline],
      present: cloneOverlayObjects(liveEdited),
      future: [],
    }

    expect(state.present[0]?.content).toBe('Hello world')
    state = historyUndo(state)
    expect(state.present[0]?.content).toBe('Hello')
  })
})
