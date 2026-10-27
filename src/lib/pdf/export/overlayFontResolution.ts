import { isPdfJsFontFaceName } from '@/lib/prices/pdfTextStyles'
import type { TextOverlayObject } from '@/types/textOverlay'

function unquote(family: string): string {
  return family.trim().replace(/^["']|["']$/g, '')
}

export function primaryFontFamily(fontFamily: string): string {
  return unquote(fontFamily.split(',')[0] ?? fontFamily)
}

/** True when a FontFace with this family is registered and loaded in this document. */
export function isFontFaceLoaded(family: string): boolean {
  if (typeof document === 'undefined' || !document.fonts) {
    return false
  }
  const wanted = unquote(family)
  for (const face of document.fonts) {
    if (unquote(face.family) === wanted && face.status === 'loaded') {
      return true
    }
  }
  return false
}

export interface ResolvedOverlayFont {
  readonly family: string
  readonly weight: 'normal' | 'bold'
  /** The overlay asked for the PDF's embedded font, which is not loaded here. */
  readonly usedFallback: boolean
}

/**
 * Amount edits can render with the PDF's own embedded font face. That face only
 * exists while the document is open in PDF.js, so fall back to the recorded system
 * font (and its weight) when it is missing.
 */
export function resolveOverlayFont(text: TextOverlayObject): ResolvedOverlayFont {
  const weight = text.fontWeight ?? 'normal'
  const primary = primaryFontFamily(text.fontFamily)
  if (text.amendment && isPdfJsFontFaceName(primary) && !isFontFaceLoaded(primary)) {
    return {
      family: text.amendment.fallbackFontFamily,
      weight: text.amendment.fallbackFontWeight,
      usedFallback: true,
    }
  }
  return { family: text.fontFamily, weight, usedFallback: false }
}

/** Removes PDF.js face names from restored overlays; they belong to a previous session. */
export function sanitizeRestoredOverlayFonts<T extends { kind: string }>(objects: readonly T[]): T[] {
  return objects.map((object) => {
    if (object.kind !== 'text') {
      return object
    }
    const text = object as unknown as TextOverlayObject
    const primary = primaryFontFamily(text.fontFamily)
    if (!isPdfJsFontFaceName(primary) || !text.amendment) {
      return object
    }
    const restored: TextOverlayObject = {
      ...text,
      fontFamily: text.amendment.fallbackFontFamily,
      fontWeight: text.amendment.fallbackFontWeight,
      amendment: { ...text.amendment, fontMatch: 'approximate' },
    }
    return restored as unknown as T
  })
}
