import { describe, expect, it } from 'vitest'
import {
  overlayManipulationEnabled,
  overlayObjectsListen,
  overlaySelectionEnabled,
} from '@/features/pdf-editor/overlayInteraction'

describe('overlayInteraction', () => {
  it('allows move/resize only in select mode', () => {
    expect(overlayManipulationEnabled('select')).toBe(true)
    expect(overlayManipulationEnabled('text')).toBe(false)
    expect(overlayManipulationEnabled('pan')).toBe(false)
  })

  it('blocks object hits while drawing a mask', () => {
    expect(overlayObjectsListen('highlight', null)).toBe(false)
  })

  it('allows selecting images after placement', () => {
    expect(overlaySelectionEnabled('image', null)).toBe(true)
    expect(overlaySelectionEnabled('image', 'asset-1')).toBe(false)
  })
})
