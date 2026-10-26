import {
  compareOverlayLayerOrder,
  isImageOverlay,
  isTextOverlay,
  type OverlayObject,
} from '@/types/overlayObjects'
import type { ImageBytesProvider } from './drawOverlays'

export interface ExportValidationResult {
  readonly ok: boolean
  readonly blockingErrors: readonly string[]
  readonly warnings: readonly string[]
  readonly exportableOverlays: readonly OverlayObject[]
}

function isValidBounds(bounds: {
  width: number
  height: number
}): boolean {
  return (
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

/**
 * Prepares overlay objects for export: dedupe by id, drop invalid geometry,
 * warn on missing assets. Editor chrome (selection handles) is not part of overlays.
 */
export function validateExportOverlays(
  overlays: readonly OverlayObject[],
  pageCount: number,
  getImageBytes: ImageBytesProvider,
): ExportValidationResult {
  const blockingErrors: string[] = []
  const warnings: string[] = []

  if (pageCount <= 0) {
    blockingErrors.push('The PDF has no pages to export.')
  }

  const byId = new Map<string, OverlayObject>()
  for (const object of overlays) {
    byId.set(object.id, object)
  }
  if (byId.size < overlays.length) {
    warnings.push(
      `${overlays.length - byId.size} duplicate overlay id(s) were merged (latest kept).`,
    )
  }

  const exportable: OverlayObject[] = []

  for (const object of [...byId.values()].sort(compareOverlayLayerOrder)) {
    if (object.pageIndex < 0 || object.pageIndex >= pageCount) {
      warnings.push(
        `Overlay on page ${object.pageIndex + 1} was skipped (document has ${pageCount} page(s)).`,
      )
      continue
    }

    if (!isValidBounds(object.bounds)) {
      warnings.push(`Overlay ${object.id} was skipped due to invalid bounds.`)
      continue
    }

    if (isTextOverlay(object) && !object.content.trim()) {
      warnings.push(`Empty text overlay on page ${object.pageIndex + 1} was skipped.`)
      continue
    }

    if (isImageOverlay(object)) {
      const bytes = getImageBytes(object.assetId)
      if (!bytes || bytes.byteLength === 0) {
        warnings.push(
          `Image overlay on page ${object.pageIndex + 1} was skipped (missing image data).`,
        )
        continue
      }
    }

    exportable.push(object)
  }

  return {
    ok: blockingErrors.length === 0,
    blockingErrors,
    warnings,
    exportableOverlays: exportable,
  }
}
