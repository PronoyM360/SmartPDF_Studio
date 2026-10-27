import { StandardFonts, type PDFFont, type PDFDocument } from 'pdf-lib'

const STANDARD_FONT_BY_FAMILY: Record<string, StandardFonts> = {
  Arial: StandardFonts.Helvetica,
  Helvetica: StandardFonts.Helvetica,
  Verdana: StandardFonts.Helvetica,
  Tahoma: StandardFonts.Helvetica,
  'Times New Roman': StandardFonts.TimesRoman,
  Georgia: StandardFonts.TimesRoman,
  'Courier New': StandardFonts.Courier,
}

function resolveStandardFont(
  fontFamily: string,
  fontWeight: 'normal' | 'bold' | undefined,
): StandardFonts {
  const isBold = fontWeight === 'bold'
  if (fontFamily === 'Times New Roman' || fontFamily === 'Georgia') {
    return isBold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman
  }
  if (fontFamily === 'Courier New') {
    return isBold ? StandardFonts.CourierBold : StandardFonts.Courier
  }
  return isBold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica
}

/** First family in a CSS list that has a standard PDF equivalent, else the first family. */
function pickKnownFamily(fontFamily: string): string {
  const families = fontFamily
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  return families.find((family) => STANDARD_FONT_BY_FAMILY[family]) ?? families[0] ?? fontFamily
}

export async function resolvePdfFont(
  pdfDoc: PDFDocument,
  fontFamilyList: string,
  cache: Map<StandardFonts, PDFFont>,
  warnedFamilies: Set<string>,
  warnings: string[],
  fontWeight?: 'normal' | 'bold',
): Promise<PDFFont> {
  const fontFamily = pickKnownFamily(fontFamilyList)
  const standard = resolveStandardFont(fontFamily, fontWeight)
  const cacheKey = standard
  if (!STANDARD_FONT_BY_FAMILY[fontFamily] && !warnedFamilies.has(fontFamily)) {
    warnedFamilies.add(fontFamily)
    warnings.push(
      `Font "${fontFamily}" is not embedded; exported text uses a standard substitute.`,
    )
  }
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }
  const embedded = await pdfDoc.embedFont(standard)
  cache.set(cacheKey, embedded)
  return embedded
}
