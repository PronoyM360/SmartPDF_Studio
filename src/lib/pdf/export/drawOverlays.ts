import { degrees, type PDFDocument, type PDFPage, type PDFFont } from 'pdf-lib'
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
import type { PageRect } from '@/types'
import type { TextOverlayObject } from '@/types/textOverlay'
import {
  computeTextExportPatchBounds,
  rasterizeTextOverlayPatch,
} from './rasterizeTextOverlayPatch'

export interface ImageBytesProvider {
  (assetId: string): Uint8Array | undefined
}

function drawMask(page: PDFPage, mask: MaskOverlayObject): void {
  page.drawRectangle({
    x: mask.bounds.x,
    y: mask.bounds.y,
    width: mask.bounds.width,
    height: mask.bounds.height,
    color: hexToRgbColor(mask.fillColor),
    opacity: mask.opacity,
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
): Promise<void> {
  const font = await resolvePdfFont(
    pdfDoc,
    object.fontFamily,
    fontCache,
    warnedFontFamilies,
    warnings,
    object.fontWeight,
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
  const maxLines = Math.max(1, Math.floor(object.bounds.height / lineHeight))

  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    const line = lines[index] ?? ''
    const textWidth = font.widthOfTextAtSize(line, object.fontSize)
    let x = object.bounds.x
    if (object.alignment === 'center') {
      x = object.bounds.x + (object.bounds.width - textWidth) / 2
    } else if (object.alignment === 'right') {
      x = object.bounds.x + object.bounds.width - textWidth
    }
    const baselineY = textLineBaselineY(object.bounds, font, object.fontSize, index, lineHeight)

    page.drawText(line, {
      x,
      y: baselineY,
      size: object.fontSize,
      font,
      color,
    })
  }
}

async function drawRasterizedTextPatch(
  pdfDoc: PDFDocument,
  page: PDFPage,
  text: TextOverlayObject,
  masks: readonly MaskOverlayObject[],
  union: PageRect,
  warnings: string[],
): Promise<boolean> {
  const png = await rasterizeTextOverlayPatch(text, masks, union)
  if (!png) {
    return false
  }
  try {
    const embedded = await pdfDoc.embedPng(png)
    page.drawImage(embedded, {
      x: union.x,
      y: union.y,
      width: union.width,
      height: union.height,
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

  const fontCache = new Map<import('pdf-lib').StandardFonts, PDFFont>()
  const warnedFontFamilies = new Set<string>()

  for (const object of pageObjects) {
    if (!isTextOverlay(object)) {
      continue
    }
    const pairedMasks = masks.filter(
      (mask) => !consumedMaskIds.has(mask.id) && pageRectsIntersect(mask.bounds, object.bounds),
    )
    const union = computeTextExportPatchBounds(object, pairedMasks)
    const rasterized = await drawRasterizedTextPatch(
      pdfDoc,
      page,
      object,
      pairedMasks,
      union,
      warnings,
    )
    if (rasterized) {
      rasterizedTextExport = true
      for (const mask of pairedMasks) {
        consumedMaskIds.add(mask.id)
      }
      continue
    }
    for (const mask of pairedMasks) {
      drawMask(page, mask)
      consumedMaskIds.add(mask.id)
    }
    await drawTextOverlay(pdfDoc, page, object, fontCache, warnedFontFamilies, warnings)
  }

  if (rasterizedTextExport) {
    warnings.push(
      'Text corrections were embedded as images so edited prices are not selectable as PDF text in most viewers.',
    )
  }

  for (const object of pageObjects) {
    if (isMaskOverlay(object)) {
      if (!consumedMaskIds.has(object.id)) {
        drawMask(page, object)
      }
      continue
    }
    if (isImageOverlay(object)) {
      await drawImageOverlay(pdfDoc, page, object, getImageBytes, warnings)
    }
  }
}
