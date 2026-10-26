import type { OverlayObject } from '@/types/overlayObjects'

/** Deep-clones overlay metadata only — image bytes stay in the asset store. */
export function cloneOverlayObjects(objects: readonly OverlayObject[]): OverlayObject[] {
  return objects.map((object) => {
    if (object.kind === 'text') {
      return {
        ...object,
        bounds: { ...object.bounds },
      }
    }
    if (object.kind === 'image') {
      return {
        ...object,
        bounds: { ...object.bounds },
      }
    }
    return {
      ...object,
      bounds: { ...object.bounds },
    }
  })
}

export interface EditorHistoryState {
  past: OverlayObject[][]
  present: OverlayObject[]
  future: OverlayObject[][]
}

export function createInitialHistoryState(): EditorHistoryState {
  return { past: [], present: [], future: [] }
}

export function historyCommit(
  state: EditorHistoryState,
  nextPresent: OverlayObject[],
): EditorHistoryState {
  return {
    past: [...state.past, cloneOverlayObjects(state.present)],
    present: cloneOverlayObjects(nextPresent),
    future: [],
  }
}

export function historyUndo(state: EditorHistoryState): EditorHistoryState {
  if (state.past.length === 0) {
    return state
  }
  const previous = state.past[state.past.length - 1]!
  return {
    past: state.past.slice(0, -1),
    present: cloneOverlayObjects(previous),
    future: [cloneOverlayObjects(state.present), ...state.future],
  }
}

export function historyRedo(state: EditorHistoryState): EditorHistoryState {
  if (state.future.length === 0) {
    return state
  }
  const next = state.future[0]!
  return {
    past: [...state.past, cloneOverlayObjects(state.present)],
    present: cloneOverlayObjects(next),
    future: state.future.slice(1),
  }
}
