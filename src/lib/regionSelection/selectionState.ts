import type { PageRect } from '@/types'

/** A rectangle the user is working with. Not an edit: it never enters history or export. */
export interface RegionSelection {
  readonly pageIndex: number
  /** PDF user space, so it stays put across zoom and rotation. */
  readonly bounds: PageRect
}

export interface RegionSelectionState {
  readonly selection: RegionSelection | null
  /** Earlier selections (null = none yet), for undoing adjustments one step at a time. */
  readonly past: readonly (RegionSelection | null)[]
}

export type RegionSelectionAction =
  | { type: 'draw'; selection: RegionSelection }
  | { type: 'adjust'; bounds: PageRect }
  | { type: 'undo' }
  | { type: 'cancel' }

const MAX_UNDO = 50

export const INITIAL_REGION_SELECTION: RegionSelectionState = { selection: null, past: [] }

function sameRect(a: PageRect, b: PageRect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.width - b.width) < 0.01 &&
    Math.abs(a.height - b.height) < 0.01
  )
}

function remember(state: RegionSelectionState): readonly (RegionSelection | null)[] {
  return [...state.past, state.selection].slice(-MAX_UNDO)
}

export function regionSelectionReducer(
  state: RegionSelectionState,
  action: RegionSelectionAction,
): RegionSelectionState {
  switch (action.type) {
    case 'draw':
      return { selection: action.selection, past: remember(state) }
    case 'adjust':
      if (!state.selection || sameRect(state.selection.bounds, action.bounds)) {
        return state
      }
      return {
        selection: { ...state.selection, bounds: action.bounds },
        past: remember(state),
      }
    case 'undo': {
      if (state.past.length === 0) {
        return state
      }
      return { selection: state.past[state.past.length - 1] ?? null, past: state.past.slice(0, -1) }
    }
    case 'cancel':
      return INITIAL_REGION_SELECTION
    default:
      return state
  }
}
