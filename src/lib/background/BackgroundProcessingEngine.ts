import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { PageRect } from '@/types'

export type BackgroundEngineId = 'solid-color' | 'inpaint'

export interface BackgroundProcessingContext {
  readonly pageIndex: number
  readonly region: PageRect
  readonly mask: MaskOverlayObject
}

export interface BackgroundProcessingPreview {
  readonly engineId: BackgroundEngineId
  readonly description: string
  readonly feasible: boolean
  readonly warnings: readonly string[]
}

export interface BackgroundProcessingEngine {
  readonly id: BackgroundEngineId
  readonly label: string
  readonly available: boolean
  readonly availabilityNote?: string
  describe(context: BackgroundProcessingContext): BackgroundProcessingPreview
}

const solidColorEngine: BackgroundProcessingEngine = {
  id: 'solid-color',
  label: 'Solid color cover',
  available: true,
  describe() {
    return {
      engineId: 'solid-color',
      description:
        'Fills the mask region with a solid color. Best for flat backgrounds and paper tones.',
      feasible: true,
      warnings: [
        'Photographs, textures, shadows, and gradients cannot be reconstructed perfectly with a flat fill.',
        'This is a visual cover only—not secure redaction.',
      ],
    }
  },
}

const inpaintEngineStub: BackgroundProcessingEngine = {
  id: 'inpaint',
  label: 'Inpainting (not installed)',
  available: false,
  availabilityNote:
    'No inpainting model is bundled in this build. Plug in a local engine via BackgroundProcessingEngine when available.',
  describe() {
    return {
      engineId: 'inpaint',
      description: 'Inpainting is not available in this application version.',
      feasible: false,
      warnings: [
        'Complex backgrounds require a future on-device inpainting engine. Until then, use solid-color masks and manual refinement.',
      ],
    }
  },
}

export const BACKGROUND_PROCESSING_ENGINES: readonly BackgroundProcessingEngine[] =
  [solidColorEngine, inpaintEngineStub]

export function getBackgroundEngine(
  id: BackgroundEngineId,
): BackgroundProcessingEngine {
  return (
    BACKGROUND_PROCESSING_ENGINES.find((engine) => engine.id === id) ??
    solidColorEngine
  )
}

export function getDefaultBackgroundEngine(): BackgroundProcessingEngine {
  return solidColorEngine
}
