import { describe, expect, it } from 'vitest'
import { workspaceCanvasLayerFlags } from './workspaceCanvasLayerFlags'

describe('workspaceCanvasLayerFlags', () => {
  it('hides all overlay layers in original-only mode', () => {
    expect(workspaceCanvasLayerFlags('original')).toEqual({
      showCommittedOverlays: false,
      showInspectLayers: false,
      showPendingReplacement: false,
    })
  })

  it('shows committed, inspect, and pending layers in edited mode', () => {
    expect(workspaceCanvasLayerFlags('edited')).toEqual({
      showCommittedOverlays: true,
      showInspectLayers: true,
      showPendingReplacement: true,
    })
  })

  it('splits side-by-side: original pane is PDF only, edited pane matches export', () => {
    expect(workspaceCanvasLayerFlags('side-by-side', 'original')).toEqual({
      showCommittedOverlays: false,
      showInspectLayers: false,
      showPendingReplacement: false,
    })
    expect(workspaceCanvasLayerFlags('side-by-side', 'edited')).toEqual({
      showCommittedOverlays: true,
      showInspectLayers: true,
      showPendingReplacement: true,
    })
  })
})
