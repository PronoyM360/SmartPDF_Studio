import { DEFAULT_TEXT_FONT_FAMILY } from '@/features/text-tools/textDefaults'

export type MappedFontWeight = 'normal' | 'bold'

export interface MappedPdfFont {
  readonly family: string
  readonly weight: MappedFontWeight
  /** True when the PDF internal name maps cleanly to a known family. */
  readonly isExactFamilyMatch: boolean
}

const FAMILY_PATTERNS: { pattern: RegExp; family: string }[] = [
  { pattern: /times|roman/i, family: 'Times New Roman' },
  { pattern: /courier|mono/i, family: 'Courier New' },
  { pattern: /georgia/i, family: 'Georgia' },
  { pattern: /verdana/i, family: 'Verdana' },
  { pattern: /tahoma/i, family: 'Tahoma' },
  { pattern: /calibri/i, family: 'Calibri' },
  { pattern: /cambria/i, family: 'Cambria' },
  { pattern: /roboto/i, family: 'Roboto' },
  { pattern: /open\s*sans/i, family: 'Open Sans' },
  { pattern: /segoe\s*ui/i, family: 'Segoe UI' },
  { pattern: /inter/i, family: 'Inter' },
  { pattern: /myriad/i, family: 'Myriad Pro' },
  { pattern: /arial/i, family: 'Arial' },
  { pattern: /helvetica|nimbus\s*san|sans/i, family: 'Helvetica' },
]

const STYLE_SUFFIX =
  /[-_,]?(bold|italic|oblique|regular|light|medium|semibold|black|heavy|mt|psmt|ps|std|pro)$/i

/** Strips PDF subset prefix (e.g. `ABCDEF+Calibri-Bold` → `Calibri-Bold`). */
export function stripPdfFontSubsetPrefix(pdfFontName: string): string {
  const trimmed = pdfFontName.trim()
  const plus = trimmed.indexOf('+')
  if (plus >= 0 && plus < trimmed.length - 1) {
    return trimmed.slice(plus + 1)
  }
  return trimmed
}

/** Human-readable CSS family from a PDF internal font name. */
export function pdfFontNameToCssFamily(pdfFontName: string): string {
  const stripped = stripPdfFontSubsetPrefix(pdfFontName)
    .replace(STYLE_SUFFIX, '')
    .replace(/[-_]/g, ' ')
    .trim()
  if (!stripped) {
    return pdfFontName.trim()
  }
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
  // e.g. GraphikUS-Bold → Graphik US, RobotoUS → Roboto US
  return spaced.replace(/([A-Za-z])US\b/g, '$1 US').trim()
}

/** True when the PDF internal name includes a US regional/style suffix (GraphikUS, etc.). */
export function pdfFontNameIncludesUsSuffix(pdfFontName: string): boolean {
  const stripped = stripPdfFontSubsetPrefix(pdfFontName)
  return /US[-_]?(Bold|Medium|Regular|Light|Black|Heavy)?/i.test(stripped)
}

function matchFamilyPattern(name: string): string | null {
  for (const { pattern, family } of FAMILY_PATTERNS) {
    if (pattern.test(name)) {
      return family
    }
  }
  return null
}

export function mapPdfFontName(pdfFontName: string): MappedPdfFont {
  const name = pdfFontName.trim()
  const weight: MappedFontWeight =
    /bold|black|heavy|semibold|demi/i.test(name) ? 'bold' : 'normal'

  const candidates = [name, stripPdfFontSubsetPrefix(name), pdfFontNameToCssFamily(name)]
  for (const candidate of candidates) {
    const family = matchFamilyPattern(candidate)
    if (family) {
      return { family, weight, isExactFamilyMatch: true }
    }
  }

  const cssFamily = pdfFontNameToCssFamily(name)
  if (cssFamily && cssFamily !== name && !name.includes(',')) {
    return {
      family: cssFamily,
      weight,
      isExactFamilyMatch: false,
    }
  }

  if (name.includes(',')) {
    return {
      family: DEFAULT_TEXT_FONT_FAMILY,
      weight,
      isExactFamilyMatch: false,
    }
  }

  return {
    family: DEFAULT_TEXT_FONT_FAMILY,
    weight,
    isExactFamilyMatch: false,
  }
}
