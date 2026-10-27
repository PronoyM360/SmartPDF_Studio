import type { PriceCandidate } from '@/types/priceEditing'

/** Text drawn by one show-text operator, with the fill colour active at that point. */
export interface TextPaintRun {
  readonly text: string
  /** `#rrggbb`; null for patterns, stroke-only or invisible text. */
  readonly color: string | null
  readonly fontId: string | null
}

export interface PdfFontInfo {
  readonly id: string
  /** The font program is embedded in the PDF (not a substituted standard font). */
  readonly embedded: boolean
  readonly type3: boolean
  readonly bold: boolean
  readonly italic: boolean
  readonly genericFamily: 'serif' | 'sans-serif' | 'monospace'
  /** CSS family PDF.js renders with: the embedded face id, or the substitute name. */
  readonly loadedName: string | null
}

export interface TextOperatorCodes {
  readonly save: number
  readonly restore: number
  readonly setFont: number
  readonly setFillRGBColor: number
  readonly setFillColorN: number
  readonly setFillTransparent?: number
  readonly setTextRenderingMode: number
  readonly showText: number
  readonly showSpacedText: number
  readonly nextLineShowText: number
  readonly nextLineSetSpacingShowText: number
}

interface GlyphLike {
  readonly unicode?: string
}

function glyphText(glyphs: unknown): string {
  if (!Array.isArray(glyphs)) {
    return ''
  }
  let text = ''
  for (const glyph of glyphs) {
    if (glyph && typeof glyph === 'object' && typeof (glyph as GlyphLike).unicode === 'string') {
      text += (glyph as GlyphLike).unicode
    }
  }
  return text
}

/** Pairs each show-text operator with the fill colour in effect (tracks save/restore). */
export function collectTextPaintRuns(
  operatorList: { readonly fnArray: ArrayLike<number>; readonly argsArray: ArrayLike<unknown> },
  ops: TextOperatorCodes,
): TextPaintRun[] {
  interface State {
    color: string | null
    fontId: string | null
    renderMode: number
  }
  let state: State = { color: '#000000', fontId: null, renderMode: 0 }
  const stack: State[] = []
  const runs: TextPaintRun[] = []
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index]
    const args = operatorList.argsArray[index] as unknown[] | null
    switch (fn) {
      case ops.save:
        stack.push({ ...state })
        break
      case ops.restore:
        state = stack.pop() ?? state
        break
      case ops.setFont:
        state = { ...state, fontId: typeof args?.[0] === 'string' ? args[0] : null }
        break
      case ops.setFillRGBColor:
        state = { ...state, color: typeof args?.[0] === 'string' ? args[0].toLowerCase() : null }
        break
      case ops.setFillColorN:
        state = { ...state, color: null }
        break
      case ops.setTextRenderingMode:
        state = { ...state, renderMode: typeof args?.[0] === 'number' ? args[0] : 0 }
        break
      case ops.showText:
      case ops.showSpacedText:
      case ops.nextLineShowText:
      case ops.nextLineSetSpacingShowText: {
        const glyphs = fn === ops.nextLineSetSpacingShowText ? args?.[2] : args?.[0]
        const text = glyphText(glyphs)
        if (text) {
          // Modes 0/2/4/6 fill glyphs; others are stroke-only, invisible or clip-only.
          const fills = state.renderMode % 2 === 0 && state.renderMode !== 8
          runs.push({ text, color: fills ? state.color : null, fontId: state.fontId })
        }
        break
      }
      default:
        break
    }
  }
  return runs
}

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * Finds the content-stream colour for each candidate. PDF.js text items keep paint
 * order, so the n-th candidate is matched to the next paint run containing its digits.
 */
export function assignPaintColors(
  candidates: readonly PriceCandidate[],
  paintRuns: readonly TextPaintRun[],
): Map<string, string | null> {
  const result = new Map<string, string | null>()
  const texts = paintRuns.map((run) => compact(run.text))
  // Position after the last match, so repeated values map to successive paint runs.
  let cursorRun = 0
  let cursorOffset = 0
  const locate = (needle: string, fromRun: number, fromOffset: number) => {
    for (let index = fromRun; index < texts.length; index += 1) {
      const at = texts[index]!.indexOf(needle, index === fromRun ? fromOffset : 0)
      if (at >= 0) {
        return { index, end: at + needle.length }
      }
    }
    return null
  }
  for (const candidate of candidates) {
    const needles = [compact(candidate.text), candidate.text.replace(/[^\d.,]/g, '')].filter(
      (needle) => needle.length >= 1,
    )
    let hit: { index: number; end: number } | null = null
    for (const needle of needles) {
      hit = locate(needle, cursorRun, cursorOffset) ?? null
      if (hit) {
        break
      }
    }
    if (hit) {
      cursorRun = hit.index
      cursorOffset = hit.end
    } else {
      for (const needle of needles) {
        hit = locate(needle, 0, 0)
        if (hit) {
          break
        }
      }
    }
    result.set(candidate.id, hit ? (paintRuns[hit.index]!.color ?? null) : null)
  }
  return result
}

interface PdfJsFontLike {
  readonly missingFile?: boolean
  readonly isType3Font?: boolean
  readonly bold?: boolean
  readonly black?: boolean
  readonly italic?: boolean
  readonly fallbackName?: string
  readonly loadedName?: string
}

interface CommonObjsLike {
  has(id: string): boolean
  get(id: string): unknown
}

/** Reads what PDF.js knows about a font after the page's operator list has loaded. */
export function readPdfFontInfo(commonObjs: CommonObjsLike, fontId: string): PdfFontInfo | null {
  let font: PdfJsFontLike
  try {
    if (!commonObjs.has(fontId)) {
      return null
    }
    font = commonObjs.get(fontId) as PdfJsFontLike
  } catch {
    return null
  }
  if (!font || typeof font !== 'object') {
    return null
  }
  const fallback = font.fallbackName ?? 'sans-serif'
  return {
    id: fontId,
    embedded: font.missingFile === false,
    type3: font.isType3Font === true,
    bold: font.bold === true || font.black === true,
    italic: font.italic === true,
    genericFamily: fallback === 'serif' || fallback === 'monospace' ? fallback : 'sans-serif',
    loadedName: font.loadedName ?? null,
  }
}

/** PDF.js names embedded font faces `g_d<doc>_f<n>`; they only exist for one loaded document. */
export function isPdfJsFontFaceName(family: string): boolean {
  return /^["']?g_d\d+_f\d+["']?$/.test(family.trim())
}
