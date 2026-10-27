import { describe, expect, it } from 'vitest'
import {
  INITIAL_REGION_SELECTION,
  regionSelectionReducer as reduce,
} from '@/lib/regionSelection/selectionState'

const first = { pageIndex: 0, bounds: { x: 10, y: 10, width: 100, height: 40 } }

describe('regionSelectionReducer', () => {
  it('undoes moves and resizes one step at a time', () => {
    let state = reduce(INITIAL_REGION_SELECTION, { type: 'draw', selection: first })
    state = reduce(state, { type: 'adjust', bounds: { x: 30, y: 10, width: 100, height: 40 } })
    state = reduce(state, { type: 'adjust', bounds: { x: 30, y: 10, width: 160, height: 60 } })
    expect(state.selection?.bounds.width).toBe(160)
    state = reduce(state, { type: 'undo' })
    expect(state.selection?.bounds).toEqual({ x: 30, y: 10, width: 100, height: 40 })
    state = reduce(state, { type: 'undo' })
    expect(state.selection).toEqual(first)
    state = reduce(state, { type: 'undo' })
    expect(state.selection).toBeNull()
  })

  it('ignores adjustments that change nothing', () => {
    const drawn = reduce(INITIAL_REGION_SELECTION, { type: 'draw', selection: first })
    expect(reduce(drawn, { type: 'adjust', bounds: { ...first.bounds } })).toBe(drawn)
  })

  it('cancel clears the selection and its undo steps', () => {
    let state = reduce(INITIAL_REGION_SELECTION, { type: 'draw', selection: first })
    state = reduce(state, { type: 'draw', selection: { pageIndex: 2, bounds: first.bounds } })
    expect(reduce(state, { type: 'cancel' })).toEqual(INITIAL_REGION_SELECTION)
  })
})
