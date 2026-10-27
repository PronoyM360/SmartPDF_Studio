import {
  degrees,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  type PDFDocument,
  type PDFPage,
  type PDFFont,
} from 'pdf-lib'
import { hexToRgbColor } from './colorUtils'
import { resolvePdfFont } from './fontMapping'
import {
  TEXT_OVERLAY_LINE_HEIGHT_RATIO,
  textLineBaselineY,
} from './textOverlayLayout'
import type { ImageOverlayObject } from '@/types/imageOverlay'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import { compareOverlayLayerOrder, isImageOverlay, isMaskOverlay, isTextOverlay } from '@/types/overlayObjects'
import { pageRectsIntersect } from '@/lib/pdf/pageRectIntersect'
import { maskModeOf } from '@/lib/redaction/maskModes'
import type { PageRect } from '@/types'
import type { TextOverlayObject } from '@/types/textOverlay'
import {
  computeTextExportPatchBounds,
  rasterizeTextOverlayPatch,
} from './rasterizeTextOverlayPatch'
import {
  displayLocalPointToUser,
  displaySize,
  normalizePageRotation,
  rotatedImagePlacement,
  type QuarterTurn,
} from './rotationFrame'

export interface ImageBytesProvider {
  (assetId: string): Uint8Array | undefined
}

function hasBackgroundPatch(mask: MaskOverlayObject): boolean {
  return Boolean(mask.backgroundPatch) && maskModeOf(mask) === 'cover'
}

/**
 * Draws a reconstructed background patch. The stored PNG is embedded as-is (no
 * re-encoding), so pixels outside the repaired glyphs stay transparent.
 */
async function drawMaskPatch(
  pdfDoc: PDFDocument,
  page: PDFPage,
  mask: MaskOverlayObject,
  getImageBytes: ImageBytesProvider,
  rotation: QuarterTurn,
  warnings: string[],
): Promise<boolean> {
  const bytes = mask.backgroundPatch ? getImageBytes(mask.backgroundPatch.assetId) : undefined
  if (!bytes) {
    warnings.push(
      `A reconstructed background on page ${mask.pageIndex + 1} is missing its image data; a flat fill was used instead.`,
    )
    return false
  }
  try {
    const embedded = await pdfDoc.embedPng(bytes)
    const placement = rotatedImagePlacement(mask.bounds, rotation)
    page.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.rotateDegrees),
    })
    return true
  } catch {
    warnings.push(
      `A reconstructed background on page ${mask.pageIndex + 1} could not be embedded; a flat fill was used instead.`,
    )
    return false
  }
}

function drawMask(page: PDFPage, mask: MaskOverlayObject): void {
  page.drawRectangle({
    x: mask.bounds.x,
    y: mask.bounds.y,
    width: mask.bounds.width,
    height: mask.bounds.height,
    color: hexToRgbColor(mask.fillColor),
    opacity: maskModeOf(mask) === 'cover' ? mask.opacity : 1,
    borderWidth: 0,
  })
}

async function drawImageOverlay(
  pdfDoc: PDFDocument,
  page: PDFPage,
  object: ImageOverlayObject,
  getImageBytes: ImageBytesProvider,
  warnings: string[],
): Promise<void> {
  const bytes = getImageBytes(object.assetId)
  if (!bytes) {
    warnings.push('An image overlay was skipped because its file data is missing.')
    return
  }
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
  const embedded = isJpeg
    ? await pdfDoc.embedJpg(bytes)
    : await pdfDoc.embedPng(bytes)

  page.drawImage(embedded, {
    x: object.bounds.x,
    y: object.bounds.y,
    width: object.bounds.width,
    height: object.bounds.height,
    rotate: degrees(object.rotation),
  })
}

async function drawTextOverlay(
  pdfDoc: PDFDocument,
  page: PDFPage,
  object: TextOverlayObject,
  fontCache: Map<import('pdf-lib').StandardFonts, PDFFont>,
  warnedFontFamilies: Set<string>,
  warnings: string[],
  rotation: QuarterTurn,
): Promise<void> {
  // Standard PDF fonts can never be the document's embedded face, so amount edits
  // use their recorded system fallback (with its real weight) here.
  const font = await resolvePdfFont(
    pdfDoc,
    object.amendment?.fallbackFontFamily ?? object.fontFamily,
    fontCache,
    warnedFontFamilies,
    warnings,
    object.amendment?.fallbackFontWeight ?? object.fontWeight,
  )
  if (object.backgroundColor) {
    page.drawRectangle({
      x: object.bounds.x,
      y: object.bounds.y,
      width: object.bounds.width,
      height: object.bounds.height,
      color: hexToRgbColor(object.backgroundColor),
      opacity: object.backgroundOpacity ?? 1,
      borderWidth: 0,
    })
  }
  const color = hexToRgbColor(object.color)
  const lines = object.content.split('\n')
  const lineHeight = object.fontSize * TEXT_OVERLAY_LINE_HEIGHT_RATIO

  const spacing = object.letterSpacing ?? 0
  if (rotation !== 0) {
    // Lay the text out in display orientation, then map each baseline origin back to
    // user space and counter-rotate the glyphs so they read upright on screen.
    const box = displaySize(object.bounds.width, object.bounds.height, rotation)
    const maxLines = Math.max(1, Math.floor(box.height / lineHeight))
    const ascent = font.heightAtSize(object.fontSize, { descender: false })
    for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
      const line = lines[index] ?? ''
      const textWidth = font.widthOfTextAtSize(line, object.fontSize) + spacing * [...line].length
      let x = 0
      if (object.alignment === 'center') {
        x = (box.width - textWidth) / 2
      } else if (object.alignment === 'right') {
        x = box.width - textWidth
      }
      const origin = displayLocalPointToUser(
        { x, y: index * lineHeight + ascent },
        object.bounds,
        rotation,
      )
      if (spacing) {
        page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing))
      }
      page.drawText(line, {
        x: origin.x,
        y: origin.y,
        size: object.fontSize,
        font,
        color,
        rotate: degrees(rotation),
      })
      if (spacing) {
        page.pushOperators(popGraphicsState())
      }
    }
    return
  }

  const maxLines = Math.max(1, Math.floor(object.bounds.height / lineHeight))
  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    const line = lines[index] ?? ''
    const textWidth = font.widthOfTextAtSize(line, object.fontSize) + spacing * [...line].length
    let x = object.bounds.x
    if (object.alignment === 'center') {
      x = object.bounds.x + (object.bounds.width - textWidth) / 2
    } else if (object.alignment === 'right') {
      x = object.bounds.x + object.bounds.width - textWidth
    }
    const recordedBaseline = object.amendment?.baselineY
    const baselineY =
      recordedBaseline !== null && recordedBaseline !== undefined
        ? recordedBaseline - index * lineHeight
        : textLineBaselineY(object.bounds, font, object.fontSize, index, lineHeight)

    if (spacing) {
      page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing))
    }
    page.drawText(line, {
      x,
      y: baselineY,
      size: object.fontSize,
      font,
      color,
    })
    if (spacing) {
      page.pushOperators(popGraphicsState())
    }
  }
}

async function drawRasterizedTextPatch(
  pdfDoc: PDFDocument,
  page: PDFPage,
  text: TextOverlayObject,
  masks: readonly MaskOverlayObject[],
  union: PageRect,
  warnings: string[],
  rotation: QuarterTurn,
): Promise<boolean> {
  // Amount and OCR patches are small, so a higher resolution keeps glyphs crisp when zoomed.
  const png = await rasterizeTextOverlayPatch(
    text,
    masks,
    union,
    text.amendment || text.ocrEdit ? 4 : undefined,
    rotation,
  )
  if (!png) {
    return false
  }
  try {
    const embedded = await pdfDoc.embedPng(png)
    const placement = rotatedImagePlacement(union, rotation)
    page.drawImage(embedded, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.rotateDegrees),
    })
    return true
  } catch {
    warnings.push('A text overlay could not be rasterized; vector fallback was used.')
    return false
  }
}

export async function drawOverlaysOnPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  pageIndex: number,
  overlays: readonly OverlayObject[],
  getImageBytes: ImageBytesProvider,
  warnings: string[],
): Promise<void> {
  const pageObjects = overlays
    .filter((object) => object.pageIndex === pageIndex)
    .sort(compareOverlayLayerOrder)

  const masks = pageObjects.filter(isMaskOverlay)
  const consumedMaskIds = new Set<string>()
  let rasterizedTextExport = false
  const rotation = normalizePageRotation(page.getRotation().angle)

  const fontCache = new Map<import('pdf-lib').StandardFonts, PDFFont>()
  const warnedFontFamilies = new Set<string>()

  for (const object of pageObjects) {
    if (!isTextOverlay(object)) {
      continue
    }
    const pairedMasks = masks.filter(
      (mask) => !consumedMaskIds.has(mask.id) && pageRectsIntersect(mask.bounds, object.bounds),
    )
    const flatMasks: MaskOverlayObject[] = []
    for (const mask of pairedMasks) {
      consumedMaskIds.add(mask.id)
      const patched =
        hasBackgroundPatch(mask) &&
        (await drawMaskPatch(pdfDoc, page, mask, getImageBytes, rotation, warnings))
      if (!patched) {
        flatMasks.push(mask)
      }
    }
    const union = computeTextExportPatchBounds(object, flatMasks)
    const rasterized = await drawRasterizedTextPatch(
      pdfDoc,
      page,
      object,
      flatMasks,
      union,
      warnings,
      rotation,
    )
    if (rasterized) {
      rasterizedTextExport = true
      continue
    }
    for (const mask of flatMasks) {
      drawMask(page, mask)
    }
    await drawTextOverlay(pdfDoc, page, object, fontCache, warnedFontFamilies, warnings, rotation)
  }

  if (rasterizedTextExport) {
    warnings.push(
      'Text corrections were embedded as images so edited prices are not selectable as PDF text in most viewers.',
    )
  }

  for (const object of pageObjects) {
    if (isMaskOverlay(object)) {
      if (consumedMaskIds.has(object.id)) {
        continue
      }
      const patched =
        hasBackgroundPatch(object) &&
        (await drawMaskPatch(pdfDoc, page, object, getImageBytes, rotation, warnings))
      if (!patched) {
        drawMask(page, object)
      }
      continue
    }
    if (isImageOverlay(object)) {
      await drawImageOverlay(pdfDoc, page, object, getImageBytes, warnings)
    }
  }
}
