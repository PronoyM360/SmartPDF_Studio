import {
  isImageOverlay,
  isMaskOverlay,
  isTextOverlay,
  type OverlayObject,
} from '@/types/overlayObjects'

const UPDATED_EPSILON_MS = 500

export interface ComparisonChangeSummary {
  textAdded: number
  textUpdated: number
  imagesAdded: number
  imagesUpdated: number
  masksAdded: number
  masksUpdated: number
  pagesWithOverlays: number[]
  /** Overlay move/resize/content updates (not native PDF text edits). */
  geometryOrContentUpdates: number
  nativePdfTextChanges: null
  visualDiffAnalyzed: boolean
  pagesWithVisualDiff: number[]
}

export function buildComparisonChangeSummary(
  overlayObjects: readonly OverlayObject[],
  visualDiffByPage: Readonly<Record<number, boolean>>,
  visualDiffAnalyzed: boolean,
): ComparisonChangeSummary {
  let textAdded = 0
  let textUpdated = 0
  let imagesAdded = 0
  let imagesUpdated = 0
  let masksAdded = 0
  let masksUpdated = 0
  let geometryOrContentUpdates = 0

  const pages = new Set<number>()

  for (const object of overlayObjects) {
    pages.add(object.pageIndex)
    const isUpdated = object.updatedAt - object.createdAt > UPDATED_EPSILON_MS

    if (isTextOverlay(object)) {
      if (isUpdated) {
        textUpdated += 1
        geometryOrContentUpdates += 1
      } else {
        textAdded += 1
      }
      continue
    }
    if (isImageOverlay(object)) {
      if (isUpdated) {
        imagesUpdated += 1
        geometryOrContentUpdates += 1
      } else {
        imagesAdded += 1
      }
      continue
    }
    if (isMaskOverlay(object)) {
      if (isUpdated) {
        masksUpdated += 1
        geometryOrContentUpdates += 1
      } else {
        masksAdded += 1
      }
    }
  }

  const pagesWithVisualDiff = Object.entries(visualDiffByPage)
    .filter(([, hasDiff]) => hasDiff)
    .map(([pageIndex]) => Number(pageIndex) + 1)
    .sort((a, b) => a - b)

  return {
    textAdded,
    textUpdated,
    imagesAdded,
    imagesUpdated,
    masksAdded,
    masksUpdated,
    pagesWithOverlays: [...pages].sort((a, b) => a - b).map((i) => i + 1),
    geometryOrContentUpdates,
    nativePdfTextChanges: null,
    visualDiffAnalyzed,
    pagesWithVisualDiff,
  }
}
