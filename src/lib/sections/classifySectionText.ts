import { SECTION_CATEGORIES } from '@/lib/sections/sectionCategories'
import type { SectionCategoryId } from '@/types/documentSections'

export function normalizeLabelText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface LabelMatch {
  readonly category: SectionCategoryId
  readonly matchedText: string
  /** Share of the line's normalized characters covered by the label (0–1). */
  readonly coverage: number
  /** Label starts at the beginning of the line. */
  readonly atStart: boolean
  readonly ambiguous: boolean
  readonly alternatives: readonly SectionCategoryId[]
}

interface PhraseHit {
  category: SectionCategoryId
  index: number
  length: number
  text: string
  ambiguousWith: readonly SectionCategoryId[]
}

const COMPILED_PHRASES = SECTION_CATEGORIES.flatMap((category) =>
  category.phrases.map((phrase) => ({
    category: category.id,
    regex: new RegExp(`(?:^| )(?:${phrase.pattern})(?= |$)`, 'gu'),
    ambiguousWith: phrase.ambiguousWith ?? [],
  })),
)

/**
 * Finds the most specific section label in a line. Longest phrase wins; competing
 * categories of similar length, or phrases marked ambiguous, flag the match as uncertain.
 */
export function matchSectionLabel(text: string): LabelMatch | null {
  const normalized = normalizeLabelText(text)
  if (!normalized) {
    return null
  }

  const bestByCategory = new Map<SectionCategoryId, PhraseHit>()
  for (const phrase of COMPILED_PHRASES) {
    phrase.regex.lastIndex = 0
    for (const match of normalized.matchAll(phrase.regex)) {
      const raw = match[0]
      const leading = raw.startsWith(' ') ? 1 : 0
      const hit: PhraseHit = {
        category: phrase.category,
        index: (match.index ?? 0) + leading,
        length: raw.length - leading,
        text: raw.trim(),
        ambiguousWith: phrase.ambiguousWith,
      }
      const existing = bestByCategory.get(phrase.category)
      if (
        !existing ||
        hit.length > existing.length ||
        (hit.length === existing.length && hit.index < existing.index)
      ) {
        bestByCategory.set(phrase.category, hit)
      }
    }
  }

  const hits = [...bestByCategory.values()].sort(
    (a, b) => b.length - a.length || a.index - b.index,
  )
  const best = hits[0]
  if (!best) {
    return null
  }

  const competitors = hits
    .slice(1)
    .filter((hit) => hit.length >= best.length * 0.6)
    .map((hit) => hit.category)
  const alternatives = [...new Set([...best.ambiguousWith, ...competitors])].filter(
    (category) => category !== best.category,
  )

  return {
    category: best.category,
    matchedText: best.text,
    coverage: Math.min(1, best.length / normalized.length),
    atStart: best.index === 0,
    ambiguous: alternatives.length > 0,
    alternatives,
  }
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/
const PHONE_RE = /(?:\+|\b)\d[\d\s()-]{7,}\d\b/
const FLIGHT_NO_RE = /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?-?\d{2,4}\b/
const TIME_RE = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/
const AIRPORT_CODE_RE = /(?:\(|\b)[A-Z]{3}(?:\)|\b)\s*(?:-|–|→|to\b)/
const BOOKING_CODE_RE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6}\b/
const WEIGHT_RE = /\b\d{1,2}\s?(?:kg|kgs|lb|lbs|pc|pcs|piece|pieces)\b/i
const TITLE_RE = /\b(?:MR|MRS|MS|MISS|MSTR|DR)\b\.?|\b(?:adult|child|infant|ADT|CHD|INF)\b/i
const MONEY_RE = /(?:[$€£¥৳₹]|\b(?:usd|eur|gbp|bdt|inr|aed|sar|myr|sgd)\b)\s?\d|\d[\d,]*\.\d{2}\b/i

interface ContentScore {
  category: SectionCategoryId
  score: number
}

/**
 * Weak, content-only classification for blocks without a recognizable heading.
 * Requires at least two independent signals before suggesting a category.
 */
export function inferCategoryFromContent(text: string): {
  category: SectionCategoryId
  alternatives: SectionCategoryId[]
} | null {
  const normalized = normalizeLabelText(text)
  const words = normalized ? normalized.split(' ').length : 0
  if (words === 0) {
    return null
  }
  const has = (re: RegExp) => (re.test(text) ? 1 : 0)
  const keyword = (re: RegExp) => (re.test(normalized) ? 1 : 0)

  const scores: ContentScore[] = [
    {
      category: 'contact',
      score:
        has(EMAIL_RE) * 2 +
        has(PHONE_RE) * 1.5 +
        keyword(/\b(?:tel|phone|email|e mail|mobile|fax|address)\b/),
    },
    {
      category: 'flight',
      score:
        has(FLIGHT_NO_RE) +
        has(TIME_RE) +
        has(AIRPORT_CODE_RE) +
        keyword(/\b(?:departs?|departure|arrives?|arrival|terminal|gate|class|cabin|economy|business|aircraft|duration|stops?|non stop)\b/),
    },
    {
      category: 'booking',
      score:
        keyword(/\b(?:pnr|booking|reservation|confirmation|reference|ref|locator|ticket)\b/) * 1.5 +
        has(BOOKING_CODE_RE) * 0.75 +
        keyword(/\b(?:issued|issue date|status|confirmed)\b/) * 0.75,
    },
    {
      category: 'baggage',
      score:
        has(WEIGHT_RE) * 1.5 +
        keyword(/\b(?:baggage|luggage|bags?|checked|cabin|carry on|allowance)\b/),
    },
    {
      category: 'passenger',
      score:
        has(TITLE_RE) * 1.5 +
        keyword(/\b(?:passengers?|travell?ers?|pax|name|surname|given name|nationality|passport|date of birth|dob)\b/),
    },
    {
      category: 'agency',
      score: keyword(/\b(?:agency|agent|iata|travels|tours|consultant)\b/) * 2,
    },
    {
      category: 'terms',
      score:
        (words >= 40 ? 1 : 0) +
        keyword(/\b(?:terms|conditions|refund|cancellation|liable|liability|subject to|non refundable|policy|regulations|must|shall)\b/) * 1.5,
    },
    {
      category: 'total',
      score: has(MONEY_RE) * 1 + keyword(/\b(?:total|amount|payable|paid)\b/),
    },
  ]

  const ranked = scores.filter((entry) => entry.score >= 2).sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (!best) {
    return null
  }
  const alternatives = ranked
    .slice(1)
    .filter((entry) => entry.score >= best.score - 1)
    .map((entry) => entry.category)
  return { category: best.category, alternatives }
}

export function looksLikeValue(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (!compact) {
    return false
  }
  const digits = compact.replace(/\D/g, '').length
  return digits > 0 && digits / compact.length >= 0.3
}

export function toTitleCase(text: string): string {
  const trimmed = text.replace(/[:\s]+$/, '').trim()
  if (!trimmed) {
    return trimmed
  }
  const letters = trimmed.replace(/[^\p{L}]/gu, '')
  const isUpper = letters.length > 0 && letters === letters.toUpperCase()
  if (!isUpper) {
    return trimmed
  }
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, prefix: string, letter: string) => prefix + letter.toUpperCase())
}
