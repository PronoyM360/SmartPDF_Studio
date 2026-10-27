import { CURRENCY_PATTERN, isCurrencyMarker, parseAmount } from '@/lib/prices/amountFormat'
import {
  classifyPriceLabel,
  cleanLabelText,
  type PriceLabelClassification,
} from '@/lib/prices/priceLabels'
import type { PageRect } from '@/types'
import type {
  PriceCandidate,
  PriceDetectionConfidence,
  PriceLabelPlacement,
  PriceRole,
  PriceTextRun,
  RejectedPriceToken,
} from '@/types/priceEditing'

/** Width of `text` in PDF points when drawn with `run`'s font and size; null if unknown. */
export type RunTextMeasurer = (text: string, run: PriceTextRun) => number | null

export interface DetectPriceOptions {
  readonly measure?: RunTextMeasurer
}

export interface PriceDetectionResult {
  readonly candidates: PriceCandidate[]
  readonly rejected: RejectedPriceToken[]
}

const MONTHS =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

/** Spans that contain digits but are never amounts; masked before amounts are read. */
const NON_PRICE_SPANS: readonly { readonly re: RegExp; readonly reason: string }[] = [
  { re: /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, reason: 'Date' },
  { re: /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, reason: 'Date' },
  {
    re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]?${MONTHS}\\b\\.?(?:[\\s,-]+\\d{2,4}\\b)?`, 'gi'),
    reason: 'Date',
  },
  {
    re: new RegExp(`\\b${MONTHS}\\b\\.?[\\s-]?\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s?\\d{4}\\b)?`, 'gi'),
    reason: 'Date',
  },
  { re: /\b(?:[01]?\d|2[0-3])[:h][0-5]\d(?::[0-5]\d)?(?:\s?[ap]\.?m\.?)?(?!\d)/gi, reason: 'Time' },
  { re: /\b\d{1,2}\.\d{2}\s?[ap]\.?m\b\.?/gi, reason: 'Time' },
  { re: /\b\d{1,2}\s?h(?:rs?)?\s?\d{1,2}\s?m(?:in)?s?\b/gi, reason: 'Duration' },
  { re: /\+\d[\d\s()-]{6,}\d/g, reason: 'Phone number' },
  { re: /\b\d{3}[-\s]?\d{10}(?:\/\d{1,2})?\b/g, reason: 'Ticket number' },
]

const MASK_CHAR = '\u0000'
const NUMBER_BLOB = /\d(?:[\d,.'\u00a0\u202f]*\d)?/g
const CURRENCY_BEFORE = new RegExp(`(${CURRENCY_PATTERN})(\\s?)$`, 'u')
const CURRENCY_AFTER = new RegExp(`^(\\s?)(${CURRENCY_PATTERN})`, 'u')
/** Two-letter currency words that double as airline codes (TK = Turkish Airlines). */
const AMBIGUOUS_CURRENCY = new Set(['TK', 'RM', 'SR', 'QR', 'RS'])
const UNIT_AFTER =
  /^\s?(?:kgs?|lbs?|pcs?|pieces?|hrs?|hours?|mins?|minutes?|kms?|mi|miles|nights?|days?|pax|adults?|child(?:ren)?|infants?|seats?|points|pts|x)\b/i
const FLIGHT_CODE_BEFORE = /(?:^|[^A-Za-z0-9])((?:[A-Z]{2}|[A-Z]\d|\d[A-Z]))\s?-?$/
const COUNT_BEFORE = /(?:^|[^\p{L}])(?:x|×|qty\.?|no\.?|nr\.?|#)\s?$/iu

function maskNonPriceSpans(text: string): { masked: string; spans: { text: string; reason: string }[] } {
  let masked = text
  const spans: { text: string; reason: string }[] = []
  for (const { re, reason } of NON_PRICE_SPANS) {
    re.lastIndex = 0
    masked = masked.replace(re, (match) => {
      if (/\d/.test(match)) {
        spans.push({ text: match.trim(), reason })
      }
      return MASK_CHAR.repeat(match.length)
    })
  }
  return { masked, spans }
}

interface RawToken {
  readonly start: number
  readonly end: number
  readonly numberStart: number
  readonly numberEnd: number
  readonly currency: string | null
  readonly currencyIsAmbiguous: boolean
  readonly flightCode: string | null
  readonly reject: string | null
}

function isWordChar(char: string | undefined): boolean {
  return Boolean(char && /[\p{L}\p{N}]/u.test(char))
}

function findTokens(text: string): { tokens: RawToken[]; masked: { text: string; reason: string }[] } {
  const { masked, spans } = maskNonPriceSpans(text)
  const blobs: { start: number; end: number }[] = []
  NUMBER_BLOB.lastIndex = 0
  for (const match of masked.matchAll(NUMBER_BLOB)) {
    const start = match.index ?? 0
    blobs.push({ start, end: start + match[0].length })
  }

  const tokens: RawToken[] = []
  for (let index = 0; index < blobs.length; index += 1) {
    let { start: numberStart, end: numberEnd } = blobs[index]!
    let before = masked.slice(0, numberStart)

    let currency: string | null = null
    let start = numberStart
    const prefix = CURRENCY_BEFORE.exec(before)
    if (prefix) {
      const marker = prefix[1]!
      const isSymbol = !/^\p{L}/u.test(marker)
      if (isSymbol || !isWordChar(before[before.length - prefix[0].length - 1])) {
        currency = marker
        start = numberStart - prefix[0].length
      }
    }

    // "1 234,56 €": join space-separated thousands groups when a currency anchors them.
    while (index + 1 < blobs.length) {
      const next = blobs[index + 1]!
      const gap = masked.slice(numberEnd, next.start)
      const right = masked.slice(next.start, next.end)
      const left = masked.slice(numberStart, numberEnd)
      const afterNext = masked.slice(next.end)
      const anchored = currency !== null || CURRENCY_AFTER.test(afterNext)
      if (gap === ' ' && anchored && /^\d{1,3}$|\d{3}$/.test(left) && !/[.,]\d{1,2}$/.test(left) && /^\d{3}(?:[.,]\d{1,2})?$/.test(right)) {
        numberEnd = next.end
        index += 1
        continue
      }
      break
    }

    let end = numberEnd
    let after = masked.slice(numberEnd)
    if (!currency) {
      const suffix = CURRENCY_AFTER.exec(after)
      if (suffix && !isWordChar(after[suffix[0].length])) {
        currency = suffix[2]!
        end = numberEnd + suffix[0].length
        after = masked.slice(end)
      }
    }
    const trailing = /^(\/-|\/=|\.-)/.exec(after)
    if (trailing) {
      end += trailing[1]!.length
      after = masked.slice(end)
    }

    before = masked.slice(0, start)
    const sign = /([-−–]\s?)$/.exec(before)
    if (sign && !isWordChar(before[before.length - sign[0].length - 1])) {
      start -= sign[0].length
      before = masked.slice(0, start)
    } else if (/\(\s?$/.test(before) && /^\s?\)/.test(after)) {
      const open = /\(\s?$/.exec(before)!
      const close = /^\s?\)/.exec(after)!
      start -= open[0].length
      end += close[0].length
      before = masked.slice(0, start)
      after = masked.slice(end)
    }

    let reject: string | null = null
    const charBefore = masked[start - 1]
    const charAfter = masked[end]
    if (charBefore === MASK_CHAR || charAfter === MASK_CHAR) {
      reject = 'Part of a date, time or reference'
    } else if (isWordChar(charBefore) || isWordChar(charAfter)) {
      reject = 'Digits are joined to letters (code, seat or reference)'
    } else if (/^\s?%/.test(after)) {
      reject = 'Percentage, not an amount'
    } else if (!currency && UNIT_AFTER.test(after)) {
      reject = 'Quantity or measure (unit follows the number)'
    } else if (!currency && COUNT_BEFORE.test(before)) {
      reject = 'Count or number reference'
    }

    const flight = currency ? null : FLIGHT_CODE_BEFORE.exec(before)
    tokens.push({
      start,
      end,
      numberStart,
      numberEnd,
      currency,
      currencyIsAmbiguous: currency !== null && AMBIGUOUS_CURRENCY.has(currency),
      flightCode: flight?.[1] ?? null,
      reject,
    })
  }
  return { tokens, masked: spans }
}

interface RunAnalysis {
  readonly run: PriceTextRun
  readonly tokens: RawToken[]
  readonly line: number
}

function isHorizontal(run: PriceTextRun): boolean {
  const angle = ((run.directionDeg % 360) + 360) % 360
  return angle < 2 || angle > 358
}

function verticalOverlap(a: PageRect, b: PageRect): number {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
}

function horizontalOverlap(a: PageRect, b: PageRect): number {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
}

/** Groups horizontal runs into visual lines (PDF space: larger y = higher on page). */
function assignLines(runs: readonly PriceTextRun[]): Map<string, number> {
  const sorted = [...runs].sort(
    (a, b) => b.bounds.y + b.bounds.height / 2 - (a.bounds.y + a.bounds.height / 2) || a.bounds.x - b.bounds.x,
  )
  const lines: { band: PageRect; ids: string[] }[] = []
  for (const run of sorted) {
    const line = lines.find((entry) => {
      const minHeight = Math.min(entry.band.height, run.bounds.height)
      return minHeight > 0 && verticalOverlap(entry.band, run.bounds) / minHeight >= 0.5
    })
    if (line) {
      line.ids.push(run.id)
    } else {
      lines.push({ band: run.bounds, ids: [run.id] })
    }
  }
  const map = new Map<string, number>()
  lines.forEach((line, index) => {
    for (const id of line.ids) {
      map.set(id, index)
    }
  })
  return map
}

function runWidth(run: PriceTextRun): number {
  return run.advanceWidth && run.advanceWidth > 0 ? run.advanceWidth : run.bounds.width
}

/** Horizontal span of `text[start, end)` inside a run, using font metrics when available. */
export function substringSpan(
  run: PriceTextRun,
  start: number,
  end: number,
  measure?: RunTextMeasurer,
): { x: number; width: number } {
  const width = runWidth(run)
  const full = run.text
  if (start <= 0 && end >= full.length) {
    return { x: run.bounds.x, width }
  }
  const fullMeasured = measure?.(full, run) ?? null
  if (fullMeasured && fullMeasured > 0) {
    const before = measure?.(full.slice(0, start), run) ?? 0
    const upto = measure?.(full.slice(0, end), run) ?? fullMeasured
    const ratio = width / fullMeasured
    return { x: run.bounds.x + before * ratio, width: Math.max((upto - before) * ratio, 1) }
  }
  const length = Math.max(full.length, 1)
  return {
    x: run.bounds.x + (width * start) / length,
    width: Math.max((width * (end - start)) / length, 1),
  }
}

interface LabelHit {
  readonly text: string
  readonly placement: PriceLabelPlacement
  readonly classification: PriceLabelClassification
}

function labelHit(text: string, placement: PriceLabelPlacement): LabelHit | null {
  const cleaned = cleanLabelText(text)
  if (!cleaned || !/\p{L}/u.test(cleaned)) {
    return null
  }
  return { text: cleaned, placement, classification: classifyPriceLabel(cleaned) }
}

function inlineLabel(analysis: RunAnalysis, tokenIndex: number): LabelHit | null {
  const token = analysis.tokens[tokenIndex]!
  const previous = analysis.tokens[tokenIndex - 1]
  return labelHit(analysis.run.text.slice(previous ? previous.end : 0, token.start), 'inline')
}

interface LeftContext {
  readonly label: LabelHit | 'amount' | null
  /** Currency printed as its own run right before the amount ("USD" | "120.00"). */
  readonly currency: string | null
}

function leftLabel(analysis: RunAnalysis, lineRuns: readonly RunAnalysis[]): LeftContext {
  const left = lineRuns
    .filter((entry) => entry.run.bounds.x + entry.run.bounds.width <= analysis.run.bounds.x + 0.5)
    .sort((a, b) => b.run.bounds.x - a.run.bounds.x)
  const parts: string[] = []
  let cursor = analysis.run.bounds.x
  let currency: string | null = null
  for (const entry of left) {
    const gap = cursor - (entry.run.bounds.x + entry.run.bounds.width)
    if (parts.length === 0 && currency === null && gap <= entry.run.fontSizePt * 1.5 && isCurrencyMarker(entry.run.text)) {
      currency = entry.run.text.trim()
      cursor = entry.run.bounds.x
      continue
    }
    if (parts.length > 0 && gap > entry.run.fontSizePt * 1.5) {
      break
    }
    const lastToken = entry.tokens[entry.tokens.length - 1]
    const remainder = lastToken ? entry.run.text.slice(lastToken.end) : entry.run.text
    // Connectors recognised as separate words ("Taxes" "&" "Surcharges") belong to the label.
    if (parts.length > 0 && !lastToken && /^[\s&/+\-–.,:()]+$/u.test(remainder)) {
      parts.unshift(remainder)
      cursor = entry.run.bounds.x
      continue
    }
    if (!/\p{L}/u.test(remainder)) {
      if (parts.length === 0) {
        return { label: lastToken ? 'amount' : null, currency }
      }
      break
    }
    parts.unshift(remainder)
    cursor = entry.run.bounds.x
    if (lastToken) {
      break
    }
  }
  return { label: parts.length > 0 ? labelHit(parts.join(' '), 'left') : null, currency }
}

const MAX_COLUMN_STEPS = 24

/**
 * Walks up a column: through amounts in earlier rows to the heading cell above them.
 * Stops at the first non-amount text, a wide vertical gap, or the top of the page.
 */
function aboveLabel(
  tokenBounds: PageRect,
  fontSize: number,
  pageRuns: readonly RunAnalysis[],
  self: RunAnalysis,
  measure?: RunTextMeasurer,
): LabelHit | null {
  let current = tokenBounds
  let currentLine = self.line
  for (let step = 0; step < MAX_COLUMN_STEPS; step += 1) {
    const top = current.y + current.height
    let best: { gap: number; text: string; isAmount: boolean; rect: PageRect; line: number } | null = null
    for (const entry of pageRuns) {
      if (entry === self || entry.line === currentLine || entry.line < 0) {
        continue
      }
      const bounds = entry.run.bounds
      const gap = bounds.y - top
      if (bounds.y + bounds.height / 2 <= top || gap > fontSize * 2.5 || gap < -bounds.height * 0.5) {
        continue
      }
      // Header runs can hold several column titles ("Base Fare   Tax   Total").
      const chunks = [...entry.run.text.matchAll(/\S+(?: \S+)*/g)].map((match) => {
        const start = match.index ?? 0
        return { text: match[0], start, end: start + match[0].length }
      })
      for (const chunk of chunks) {
        const span = substringSpan(entry.run, chunk.start, chunk.end, measure)
        const chunkRect = { x: span.x, y: bounds.y, width: span.width, height: bounds.height }
        const rightAligned =
          Math.abs(span.x + span.width - (tokenBounds.x + tokenBounds.width)) <= fontSize * 0.6
        if (horizontalOverlap(chunkRect, tokenBounds) <= 0 && !rightAligned) {
          continue
        }
        const isAmount = entry.tokens.some(
          (token) => !token.reject && token.start < chunk.end && token.end > chunk.start,
        )
        if (!best || gap < best.gap) {
          best = { gap, text: chunk.text, isAmount, rect: chunkRect, line: entry.line }
        }
      }
    }
    if (!best) {
      return null
    }
    if (!best.isAmount) {
      return labelHit(best.text, 'above')
    }
    current = best.rect
    currentLine = best.line
  }
  return null
}

function confidenceRank(value: PriceDetectionConfidence): number {
  return value === 'high' ? 2 : value === 'medium' ? 1 : 0
}

function capConfidence(
  value: PriceDetectionConfidence,
  cap: PriceDetectionConfidence,
): PriceDetectionConfidence {
  return confidenceRank(value) <= confidenceRank(cap) ? value : cap
}

export function priceCandidateId(input: {
  source: string
  pageIndex: number
  bounds: PageRect
  text: string
}): string {
  const x = Math.round(input.bounds.x * 10) / 10
  const y = Math.round(input.bounds.y * 10) / 10
  return `${input.source}:${input.pageIndex}:${x}:${y}:${input.text}`
}

function detectOnPage(
  runs: readonly PriceTextRun[],
  options: DetectPriceOptions,
  rejected: RejectedPriceToken[],
): PriceCandidate[] {
  const lineOf = assignLines(runs.filter(isHorizontal))
  const analyses: RunAnalysis[] = runs.map((run) => {
    const { tokens, masked } = findTokens(run.text)
    for (const span of masked) {
      rejected.push({ pageIndex: run.pageIndex, text: span.text, reason: span.reason })
    }
    return { run, tokens, line: lineOf.get(run.id) ?? -1 }
  })
  const byLine = new Map<number, RunAnalysis[]>()
  for (const analysis of analyses) {
    if (analysis.line < 0) {
      continue
    }
    const list = byLine.get(analysis.line) ?? []
    list.push(analysis)
    byLine.set(analysis.line, list)
  }

  const candidates: PriceCandidate[] = []
  for (const analysis of analyses) {
    const { run } = analysis
    analysis.tokens.forEach((token, tokenIndex) => {
      const text = run.text.slice(token.start, token.end).trim()
      const reject = (reason: string): void => {
        rejected.push({ pageIndex: run.pageIndex, text, reason })
      }
      if (token.reject) {
        reject(token.reject)
        return
      }
      const amount = parseAmount(text)
      if (!amount) {
        reject('Digits do not form a consistent number')
        return
      }

      const span = substringSpan(run, token.start, token.end, options.measure)
      const bounds: PageRect = { x: span.x, y: run.bounds.y, width: span.width, height: run.bounds.height }
      const horizontal = isHorizontal(run)

      const lineRuns = horizontal ? (byLine.get(analysis.line) ?? []).filter((entry) => entry !== analysis) : []
      const inline = inlineLabel(analysis, tokenIndex)
      const leftContext =
        tokenIndex === 0 && horizontal ? leftLabel(analysis, lineRuns) : { label: null, currency: null }
      const left = !inline || inline.classification.kind === 'neutral' ? leftContext.label : null
      const leftHit = left === 'amount' ? null : left
      const separateCurrency = amount.currency === null && token.start === 0 ? leftContext.currency : null
      const sameLine = [inline, leftHit].find((hit) => hit && hit.classification.kind !== 'neutral') ?? null
      let label: LabelHit | null = sameLine
      // A column heading can explain a row whose left cell names a passenger type or
      // quantity ("Adult  5000  784" under "Base Fare  Tax"); identifiers and inline
      // labels ("Flight BG 147") are never overridden.
      const overridable =
        !sameLine || (sameLine.placement === 'left' && sameLine.classification.kind === 'count')
      if (horizontal && overridable) {
        const above = aboveLabel(bounds, run.fontSizePt, analyses, analysis, options.measure)
        if (above?.classification.kind === 'price' || (!sameLine && above?.classification.kind !== 'neutral')) {
          label = above
        }
      }
      label = label ?? inline ?? leftHit
      const kind = label?.classification.kind ?? 'neutral'

      const digitsOnly = amount.raw.replace(/\D/g, '')
      const plainInteger = amount.groupSeparator === null && amount.decimalSeparator === null
      const strongCurrency =
        (amount.currency !== null && !token.currencyIsAmbiguous) ||
        (separateCurrency !== null && !AMBIGUOUS_CURRENCY.has(separateCurrency))
      const decimals = amount.fractionDigits === 2 || amount.fractionDigits === 3
      const formatted = decimals || amount.groupSeparator !== null

      if (kind === 'count' && !strongCurrency) {
        reject(`Labelled “${label!.text}” — a quantity, not a price`)
        return
      }
      if (kind === 'identifier' && !strongCurrency) {
        reject(`Labelled “${label!.text}” — an identifier, not a price`)
        return
      }
      if (plainInteger && digitsOnly.length >= 7 && !strongCurrency) {
        reject('Long number without currency — likely an identifier')
        return
      }
      if (token.flightCode && kind !== 'price' && !strongCurrency && !formatted) {
        reject(`Looks like a flight number (${token.flightCode} ${digitsOnly})`)
        return
      }
      if (token.currencyIsAmbiguous && kind !== 'price' && !formatted) {
        reject(`“${amount.currency} ${digitsOnly}” could be a flight number; no price label nearby`)
        return
      }

      const reasons: string[] = []
      let role: PriceRole = 'other'
      let confidence: PriceDetectionConfidence
      if (kind === 'price') {
        role = label!.classification.role ?? 'other'
        reasons.push(
          label!.placement === 'above'
            ? `Column heading “${label!.text}” above the value`
            : `Label “${label!.text}” on the same line`,
        )
        confidence = label!.placement === 'above' && !strongCurrency ? 'medium' : 'high'
      } else if (strongCurrency) {
        reasons.push('Currency marker without a recognised price label')
        confidence = 'medium'
      } else if (decimals && amount.value !== 0) {
        reasons.push('Two-decimal number without a label or currency')
        confidence = 'low'
      } else {
        reject('No price label or currency nearby')
        return
      }
      if (amount.currency) {
        reasons.push(`Currency “${amount.currency}”`)
      } else if (separateCurrency) {
        reasons.push(`Currency “${separateCurrency}” printed just before the number (kept as is)`)
      }
      if (token.flightCode) {
        reasons.push(`Preceded by code “${token.flightCode}” — treated as part of the label`)
        confidence = capConfidence(confidence, 'medium')
      }
      if (kind === 'identifier' || kind === 'count') {
        reasons.push(`Near “${label!.text}”, which usually labels an identifier or quantity`)
        confidence = 'low'
      }
      if (run.source === 'ocr' && run.ocrConfidence !== null) {
        reasons.push(`OCR confidence ${Math.round(run.ocrConfidence)}%`)
        confidence = capConfidence(confidence, run.ocrConfidence >= 85 ? 'high' : run.ocrConfidence >= 60 ? 'medium' : 'low')
      }
      if (run.positionReliability === 'low') {
        reasons.push('Text position could not be measured precisely')
        confidence = capConfidence(confidence, 'medium')
      }

      candidates.push({
        id: priceCandidateId({ source: run.source, pageIndex: run.pageIndex, bounds, text }),
        pageIndex: run.pageIndex,
        source: run.source,
        runId: run.id,
        runText: run.text,
        startIndex: token.start,
        endIndex: token.end,
        text,
        amount,
        bounds,
        baseline: run.baseline ? { x: bounds.x, y: run.baseline.y } : null,
        role,
        label: label && label.classification.kind !== 'neutral' ? label.text : (label?.text ?? null),
        labelPlacement: label?.placement ?? null,
        confidence,
        reasons,
        fontName: run.fontName,
        fontSizePt: run.fontSizePt,
        ocrConfidence: run.ocrConfidence,
        duplicateCount: 1,
        editable: horizontal,
        blockedReason: horizontal ? null : 'Rotated text cannot be replaced with an overlay yet.',
      })
    })
  }
  return candidates
}

/** Detects price candidates across pages and annotates duplicate values. */
export function detectPriceCandidates(
  runs: readonly PriceTextRun[],
  options: DetectPriceOptions = {},
): PriceDetectionResult {
  const rejected: RejectedPriceToken[] = []
  const byPage = new Map<number, PriceTextRun[]>()
  for (const run of runs) {
    const list = byPage.get(run.pageIndex) ?? []
    list.push(run)
    byPage.set(run.pageIndex, list)
  }
  const candidates = [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, pageRuns]) => detectOnPage(pageRuns, options, rejected))
  return { candidates: annotateDuplicates(candidates), rejected }
}

export function amountValueKey(value: number): string {
  return Math.abs(value).toFixed(4)
}

export function annotateDuplicates(candidates: readonly PriceCandidate[]): PriceCandidate[] {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    const key = amountValueKey(candidate.amount.value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return candidates.map((candidate) => ({
    ...candidate,
    duplicateCount: counts.get(amountValueKey(candidate.amount.value)) ?? 1,
  }))
}

/** Reading order: page, then top-to-bottom, then left-to-right. */
export function comparePriceCandidates(a: PriceCandidate, b: PriceCandidate): number {
  if (a.pageIndex !== b.pageIndex) {
    return a.pageIndex - b.pageIndex
  }
  const rowA = a.bounds.y + a.bounds.height / 2
  const rowB = b.bounds.y + b.bounds.height / 2
  if (Math.abs(rowA - rowB) > Math.min(a.bounds.height, b.bounds.height) * 0.5) {
    return rowB - rowA
  }
  return a.bounds.x - b.bounds.x
}
