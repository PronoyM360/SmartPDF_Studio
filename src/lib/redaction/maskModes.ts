import type { MaskMode, MaskOverlayObject } from '@/types/maskOverlay'
import { isMaskOverlay, type OverlayObject } from '@/types/overlayObjects'

export function maskModeOf(mask: MaskOverlayObject): MaskMode {
  return mask.mode ?? 'cover'
}

export const MASK_MODE_LABELS: Record<MaskMode, { short: string; long: string }> = {
  hide: {
    short: 'Hidden (preview only)',
    long: 'Hidden in the editor preview only. Not included in the downloaded PDF.',
  },
  cover: {
    short: 'Visual cover',
    long: 'An opaque box is drawn on top in the export. The original content is still in the file underneath — this is not secure redaction.',
  },
  redact: {
    short: 'Redaction',
    long: 'On export the page is flattened to an image with this area filled, so the original content is removed from that page. Verified after export.',
  },
}

/** Overlays that belong in the exported PDF (and in export-matching comparison views). */
export function exportableOverlayObjects(
  overlays: readonly OverlayObject[],
): OverlayObject[] {
  return overlays.filter((object) => !(isMaskOverlay(object) && maskModeOf(object) === 'hide'))
}

export interface ModificationSummary {
  readonly hidden: number
  readonly covers: number
  readonly redactions: number
  readonly textEdits: number
  /** Text overlays that replace a printed amount (subset excluded from `textEdits`). */
  readonly amountEdits: number
  readonly amountEditPages: readonly number[]
  /** Text overlays that replace OCR-recognised text in a scan (excluded from `textEdits`). */
  readonly ocrEdits: number
  readonly ocrEditPages: readonly number[]
  readonly images: number
  /** Comment annotations; they do not change page content. */
  readonly annotations: number
  readonly redactedPages: readonly number[]
}

/** Edits that alter what a printed or scanned document states; the copy must say it is modified. */
export function requiresModifiedCopyLabel(summary: ModificationSummary): boolean {
  return summary.amountEdits > 0 || summary.ocrEdits > 0
}

export function summarizeModifications(overlays: readonly OverlayObject[]): ModificationSummary {
  let hidden = 0
  let covers = 0
  let redactions = 0
  let textEdits = 0
  let amountEdits = 0
  let ocrEdits = 0
  let images = 0
  let annotations = 0
  const redactedPages = new Set<number>()
  const amountEditPages = new Set<number>()
  const ocrEditPages = new Set<number>()
  // Covers paired with an amount edit are part of that edit, not separate covers.
  const amountMaskIds = new Set(
    overlays.flatMap((object) => (object.kind === 'text' && object.amendment ? [object.amendment.maskId] : [])),
  )
  for (const object of overlays) {
    if (object.kind === 'text') {
      if (object.amendment) {
        amountEdits += 1
        amountEditPages.add(object.pageIndex)
      } else if (object.ocrEdit) {
        ocrEdits += 1
        ocrEditPages.add(object.pageIndex)
      } else {
        textEdits += 1
      }
      continue
    }
    // Amount covers and rebuilt OCR backgrounds are part of their text edit.
    if (amountMaskIds.has(object.id) || (object.kind === 'mask' && object.backgroundPatch)) {
      continue
    }
    if (object.kind === 'image') {
      images += 1
      continue
    }
    if (object.kind === 'annotation') {
      annotations += 1
      continue
    }
    const mode = maskModeOf(object)
    if (mode === 'hide') {
      hidden += 1
    } else if (mode === 'redact') {
      redactions += 1
      redactedPages.add(object.pageIndex)
    } else {
      covers += 1
    }
  }
  return {
    hidden,
    covers,
    redactions,
    textEdits,
    amountEdits,
    amountEditPages: [...amountEditPages].sort((a, b) => a - b),
    ocrEdits,
    ocrEditPages: [...ocrEditPages].sort((a, b) => a - b),
    images,
    annotations,
    redactedPages: [...redactedPages].sort((a, b) => a - b),
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** Short statement for the exported copy, e.g. "1 redaction, 2 visual covers". Hidden regions are not exported. */
export function describeExportedModifications(summary: ModificationSummary): string | null {
  const parts: string[] = []
  if (summary.redactions > 0) {
    parts.push(plural(summary.redactions, 'redaction'))
  }
  if (summary.amountEdits > 0) {
    parts.push(plural(summary.amountEdits, 'edited amount'))
  }
  if (summary.ocrEdits > 0) {
    parts.push(plural(summary.ocrEdits, 'edit') + ' to scanned text')
  }
  if (summary.covers > 0) {
    parts.push(plural(summary.covers, 'visual cover'))
  }
  if (summary.textEdits > 0) {
    parts.push(plural(summary.textEdits, 'text edit'))
  }
  if (summary.images > 0) {
    parts.push(plural(summary.images, 'added image'))
  }
  if (summary.annotations > 0) {
    parts.push(plural(summary.annotations, 'annotation'))
  }
  return parts.length > 0 ? parts.join(', ') : null
}
