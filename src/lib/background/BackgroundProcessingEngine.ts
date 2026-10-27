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

const localRepairEngine: BackgroundProcessingEngine = {
  id: 'inpaint',
  label: 'Local reconstruction',
  available: true,
  availabilityNote:
    'Created from the OCR edit dialog: the region is rendered at the scan resolution and only the old glyph pixels are rebuilt from their surroundings (solid, gradient or diffusion inpainting). No machine-learning model is used.',
  describe(context) {
    const patched = Boolean(context.mask.backgroundPatch)
    return {
      engineId: 'inpaint',
      description: patched
        ? 'This box shows a reconstructed background patch instead of a flat fill.'
        : 'Reconstruction is created from the OCR edit dialog; this box uses a flat fill.',
      feasible: patched,
      warnings: [
        'Reconstruction follows nearby pixels. Textures, photos, logos and barcodes are smoothed, not recreated.',
        'The patch was made for its original position — moving or resizing the box misaligns it.',
      ],
    }
  },
}

export const BACKGROUND_PROCESSING_ENGINES: readonly BackgroundProcessingEngine[] =
  [solidColorEngine, localRepairEngine]

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
