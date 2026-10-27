import {
  createTextOverlayObject,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  MIN_TEXT_BOX_HEIGHT_PT,
} from '@/features/text-tools/textDefaults'
import type { PageRect } from '@/types'
import type { MaskBackgroundPatch, OcrEditRecord } from '@/types/backgroundRepair'
import type { MaskMode, MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import type { AmountAmendment } from '@/types/priceEditing'
import type { TextOverlayObject } from '@/types/textOverlay'

export interface OverlayTextCorrectionInput {
  pageIndex: number
  bounds: PageRect
  originalText: string
  replacementText: string
  fontSizeHint?: number
  fontFamily?: string
  color?: string
  alignment?: TextOverlayObject['alignment']
  fontWeight?: TextOverlayObject['fontWeight']
  letterSpacing?: number
  maskBounds?: PageRect
  maskFillColor?: string
  maskOpacity?: number
  /** Reconstructed background drawn instead of a flat fill; the text then has no box fill. */
  maskBackgroundPatch?: MaskBackgroundPatch
  ocrEdit?: OcrEditRecord
  editSource?: 'pdf_text' | 'ocr'
  /** Records that this correction changes a printed amount; `maskId` is filled in here. */
  amendment?: Omit<AmountAmendment, 'maskId'>
  /** Overlays this correction supersedes (e.g. an earlier edit of the same amount). */
  replaceObjectIds?: readonly string[]
}

export function createMaskObject(
  pageIndex: number,
  bounds: PageRect,
  fillColor = '#ffffff',
  opacity = 1,
  extra: {
    mode?: MaskMode
    label?: string
    sourceSectionId?: string
    backgroundPatch?: MaskBackgroundPatch
  } = {},
): MaskOverlayObject {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    kind: 'mask',
    pageIndex,
    bounds,
    fillColor,
    opacity,
    createdAt: now,
    updatedAt: now,
    ...(extra.mode && extra.mode !== 'cover' ? { mode: extra.mode } : {}),
    ...(extra.label ? { label: extra.label } : {}),
    ...(extra.sourceSectionId ? { sourceSectionId: extra.sourceSectionId } : {}),
    ...(extra.backgroundPatch ? { backgroundPatch: extra.backgroundPatch } : {}),
  }
}

/** Mask that hides the original text plus the replacement text overlay drawn on it. */
export function buildTextCorrectionOverlays(
  input: OverlayTextCorrectionInput,
): [MaskOverlayObject, TextOverlayObject] {
  const padding = 2
  // OCR layouts are measured in display space (rotation included) and used as-is.
  const width = input.ocrEdit ? input.bounds.width : Math.max(input.bounds.width, 24)
  // Widen around the anchored edge so short right-aligned or centred values stay put.
  const grow = width - input.bounds.width
  const shift = input.alignment === 'right' ? grow : input.alignment === 'center' ? grow / 2 : 0
  const textBounds: PageRect = {
    x: input.bounds.x - shift,
    y: input.bounds.y,
    width,
    height: input.ocrEdit ? input.bounds.height : Math.max(input.bounds.height, MIN_TEXT_BOX_HEIGHT_PT),
  }
  const maskBounds: PageRect = input.maskBounds ?? {
    x: Math.max(0, textBounds.x - padding),
    y: Math.max(0, textBounds.y - padding),
    width: textBounds.width + padding * 2,
    height: textBounds.height + padding * 2,
  }
  const maskFill = input.maskFillColor ?? '#ffffff'
  const maskOpacity = input.maskBackgroundPatch ? 1 : (input.maskOpacity ?? 1)
  const patch = input.maskBackgroundPatch
  const mask = createMaskObject(
    input.pageIndex,
    maskBounds,
    maskFill,
    maskOpacity,
    input.amendment
      ? { label: `Covers original amount ${input.amendment.originalText}` }
      : patch
        ? {
            label: `OCR edit of “${input.originalText.trim().slice(0, 32)}”`,
            backgroundPatch: patch,
          }
        : {},
  )
  const fontSize = Math.min(
    Math.max(input.fontSizeHint ?? DEFAULT_TEXT_FONT_SIZE, input.ocrEdit ? 3 : 6),
    120,
  )
  const text: TextOverlayObject = {
    ...createTextOverlayObject(input.pageIndex, textBounds),
    content: input.replacementText,
    fontSize,
    fontFamily: input.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    color: input.color ?? DEFAULT_TEXT_COLOR,
    ...(patch ? {} : { backgroundColor: maskFill, backgroundOpacity: maskOpacity }),
    alignment: input.alignment ?? 'left',
    fontWeight: input.fontWeight ?? 'normal',
    ...(input.letterSpacing ? { letterSpacing: input.letterSpacing } : {}),
    ...(input.amendment
      ? { amendment: { ...input.amendment, maskId: mask.id } }
      : { replacement: { originalText: input.originalText, maskId: mask.id } }),
    ...(input.ocrEdit ? { ocrEdit: input.ocrEdit } : {}),
  }
  return [mask, text]
}

export interface PreparedTextCorrections {
  readonly added: readonly OverlayObject[]
  readonly removeIds: ReadonlySet<string>
}

export function prepareTextCorrections(
  inputs: readonly OverlayTextCorrectionInput[],
): PreparedTextCorrections {
  return {
    added: inputs.flatMap((input) => buildTextCorrectionOverlays(input)),
    removeIds: new Set(inputs.flatMap((input) => input.replaceObjectIds ?? [])),
  }
}

/** Superseded overlays out, new mask + text pairs in. */
export function mergeTextCorrections(
  current: readonly OverlayObject[],
  prepared: PreparedTextCorrections,
): OverlayObject[] {
  return [...current.filter((object) => !prepared.removeIds.has(object.id)), ...prepared.added]
}

export interface CommittedAmountEdit {
  readonly amendment: AmountAmendment
  readonly textId: string
  /** What the overlay currently shows (the user may have edited it afterwards). */
  readonly content: string
}

/** Amount edits present in the committed overlays, keyed by the edited candidate. */
export function committedAmountEdits(overlays: readonly OverlayObject[]): Map<string, CommittedAmountEdit> {
  const edits = new Map<string, CommittedAmountEdit>()
  for (const object of overlays) {
    if (object.kind === 'text' && object.amendment) {
      edits.set(object.amendment.targetKey, {
        amendment: object.amendment,
        textId: object.id,
        content: object.content,
      })
    }
  }
  return edits
}
