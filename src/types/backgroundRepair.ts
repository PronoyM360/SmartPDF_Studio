/**
 * solid    — near-uniform paper or fill colour.
 * gradient — smooth colour ramp (fits a plane with low residual).
 * lines    — mostly uniform, crossed by straight rules (tables, underlines, borders).
 * textured — paper grain, noise, halftone or soft photo areas.
 * complex  — high-contrast detail around the text (logos, barcodes, busy photos).
 */
export type RegionBackgroundKind = 'solid' | 'gradient' | 'lines' | 'textured' | 'complex'

/** How the pixels under removed glyphs are rebuilt. */
export type BackgroundRepairMethod = 'solid' | 'gradient' | 'inpaint'

/** Repair choice offered to the user; `flat-box` is the legacy opaque rectangle. */
export type BackgroundRepairChoice = 'auto' | BackgroundRepairMethod | 'flat-box'

export interface MaskBackgroundPatch {
  /**
   * PNG image asset (with alpha) drawn in place of the flat fill. Transparent pixels
   * leave the original page visible. Pixels are in page display orientation, i.e.
   * after the page /Rotate is applied.
   */
  readonly assetId: string
  readonly method: BackgroundRepairMethod
  readonly backgroundKind: RegionBackgroundKind
}

export interface OcrEditRecord {
  readonly recognizedText: string
  readonly confidence: number
  readonly backgroundKind: RegionBackgroundKind | null
  readonly repairMethod: BackgroundRepairMethod | 'flat-box'
}
