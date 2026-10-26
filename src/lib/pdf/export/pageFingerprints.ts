import type { PDFDocument } from 'pdf-lib'

export interface PageFingerprint {
  readonly pageIndex: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}

const DIMENSION_TOLERANCE_PT = 0.5
const ROTATION_TOLERANCE_DEG = 0.1

export function readPdfLibPageFingerprints(doc: PDFDocument): PageFingerprint[] {
  const count = doc.getPageCount()
  const fingerprints: PageFingerprint[] = []
  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    const page = doc.getPage(pageIndex)
    fingerprints.push({
      pageIndex,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
    })
  }
  return fingerprints
}

export function comparePageFingerprints(
  before: readonly PageFingerprint[],
  after: readonly PageFingerprint[],
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (before.length !== after.length) {
    errors.push(
      `Page count changed during export (${before.length} → ${after.length}).`,
    )
    return { ok: false, errors, warnings }
  }

  for (let index = 0; index < before.length; index += 1) {
    const source = before[index]!
    const exported = after[index]!
    if (
      Math.abs(source.width - exported.width) > DIMENSION_TOLERANCE_PT ||
      Math.abs(source.height - exported.height) > DIMENSION_TOLERANCE_PT
    ) {
      errors.push(
        `Page ${index + 1} size changed (${source.width.toFixed(1)}×${source.height.toFixed(1)} pt → ${exported.width.toFixed(1)}×${exported.height.toFixed(1)} pt).`,
      )
    }
    if (
      Math.abs(source.rotation - exported.rotation) > ROTATION_TOLERANCE_DEG
    ) {
      errors.push(
        `Page ${index + 1} rotation changed (${source.rotation}° → ${exported.rotation}°).`,
      )
    }
  }

  if (errors.length === 0) {
    warnings.push(
      'Page count, dimensions, and rotation match the source document.',
    )
  }

  return { ok: errors.length === 0, errors, warnings }
}
