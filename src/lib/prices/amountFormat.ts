import type { NegativeStyle, ParsedAmount } from '@/types/priceEditing'

export const CURRENCY_SYMBOLS = '$€£¥৳₹₨₱₩₫₺₦₪₽฿₴₸₾'

/** Uppercase ISO codes plus common local abbreviations seen on tickets and invoices. */
export const CURRENCY_WORDS = [
  'USD', 'EUR', 'GBP', 'BDT', 'INR', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'JOD',
  'MYR', 'SGD', 'THB', 'JPY', 'CNY', 'RMB', 'PKR', 'LKR', 'NPR', 'CAD', 'AUD', 'NZD',
  'CHF', 'HKD', 'TRY', 'IDR', 'PHP', 'VND', 'KRW', 'EGP', 'ZAR', 'NGN', 'KES', 'MVR',
  'BTN', 'MMK', 'NUC', 'Tk.', 'Tk', 'TK.', 'TK', 'Taka', 'Rs.', 'Rs', 'RS.', 'RM', 'Dhs',
  'SR', 'QR', 'US$', 'S$', 'A$', 'C$', 'HK$',
] as const

const CURRENCY_WORD_ALT = [...CURRENCY_WORDS]
  .sort((a, b) => b.length - a.length)
  .map((word) => word.replace(/[.$]/g, (char) => `\\${char}`))
  .join('|')

/** Currency marker: a symbol, or a code/word that is not glued to further letters. */
export const CURRENCY_PATTERN = `(?:${CURRENCY_WORD_ALT})(?![\\p{L}])|[${CURRENCY_SYMBOLS}]`

const CURRENCY_ONLY_RE = new RegExp(`^(?:${CURRENCY_PATTERN})$`, 'u')
const LEADING_CURRENCY_RE = new RegExp(`^(${CURRENCY_PATTERN})(\\s*)`, 'u')
const TRAILING_CURRENCY_RE = new RegExp(`(\\s*)(${CURRENCY_PATTERN})$`, 'u')

const ISO_BY_MARKER: Record<string, string> = {
  $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '৳': 'BDT', '₹': 'INR',
  '₨': 'PKR', '₱': 'PHP', '₩': 'KRW', '₫': 'VND', '₺': 'TRY', '₦': 'NGN', '₪': 'ILS',
  '₽': 'RUB', '฿': 'THB', TK: 'BDT', 'TK.': 'BDT', TAKA: 'BDT', RS: 'INR', 'RS.': 'INR',
  RM: 'MYR', DHS: 'AED', SR: 'SAR', QR: 'QAR', 'S$': 'SGD', 'A$': 'AUD', 'C$': 'CAD',
  'HK$': 'HKD', RMB: 'CNY',
}

export function isCurrencyMarker(text: string): boolean {
  return CURRENCY_ONLY_RE.test(text.trim())
}

/** Best-effort ISO code for a currency marker; null when unknown or ambiguous. */
export function currencyCodeFor(marker: string | null): string | null {
  if (!marker) {
    return null
  }
  const upper = marker.trim().toUpperCase()
  if (ISO_BY_MARKER[upper]) {
    return ISO_BY_MARKER[upper]
  }
  return /^[A-Z]{3}$/.test(upper) ? upper : null
}

interface NumberShape {
  readonly value: number
  readonly groupSeparator: string | null
  readonly groupStyle: 'western' | 'indian' | null
  readonly decimalSeparator: '.' | ',' | null
  readonly fractionDigits: number
}

const GROUP_CHARS = new Set([',', '.', ' ', '\u00a0', '\u202f', "'"])

/**
 * Reads digits with optional grouping and decimal separators. Returns null when the
 * grouping is inconsistent (e.g. "1,23.4,5"), so identifiers are not misread as money.
 */
export function parseNumberShape(text: string): NumberShape | null {
  const body = text.trim()
  if (!/^\d[\d,.'\s\u00a0\u202f]*$/.test(body) || !/\d$/.test(body)) {
    return null
  }
  const separators = [...body].filter((char) => GROUP_CHARS.has(char))
  if (separators.length === 0) {
    return {
      value: Number(body),
      groupSeparator: null,
      groupStyle: null,
      decimalSeparator: null,
      fractionDigits: 0,
    }
  }

  let decimalSeparator: '.' | ',' | null = null
  const last = separators[separators.length - 1]!
  const lastIndex = body.lastIndexOf(last)
  const tail = body.slice(lastIndex + 1)
  const distinct = new Set(separators)

  if (last === '.' || last === ',') {
    const sameCount = separators.filter((char) => char === last).length
    if (distinct.size > 1) {
      decimalSeparator = last
    } else if (sameCount === 1 && tail.length !== 3) {
      decimalSeparator = last
    } else if (sameCount === 1 && tail.length === 3 && last === '.') {
      // "1.234" — read as a decimal; European thousands need a second group or a comma decimal.
      decimalSeparator = '.'
    }
  }

  const integerPart = decimalSeparator ? body.slice(0, lastIndex) : body
  const fraction = decimalSeparator ? tail : ''
  if (decimalSeparator && (fraction.length < 1 || fraction.length > 3 || !/^\d+$/.test(fraction))) {
    return null
  }

  const groupChars = [...integerPart].filter((char) => GROUP_CHARS.has(char))
  const groupSet = new Set(groupChars)
  if (groupSet.size > 1) {
    return null
  }
  const groupSeparator = groupChars[0] ?? null
  if (groupSeparator && groupSeparator === decimalSeparator) {
    return null
  }

  let groupStyle: 'western' | 'indian' | null = null
  if (groupSeparator) {
    const groups = integerPart.split(groupSeparator)
    const [head, ...rest] = groups
    if (!head || head.length > 3 || rest.length === 0) {
      return null
    }
    const lastGroup = rest[rest.length - 1]!
    const middle = rest.slice(0, -1)
    if (lastGroup.length !== 3) {
      return null
    }
    if (middle.every((group) => group.length === 3)) {
      groupStyle = 'western'
    } else if (middle.every((group) => group.length === 2) && head.length <= 2) {
      groupStyle = 'indian'
    } else {
      return null
    }
  }

  const digits = groupSeparator ? integerPart.split(groupSeparator).join('') : integerPart
  if (!/^\d+$/.test(digits)) {
    return null
  }
  const value = Number(fraction ? `${digits}.${fraction}` : digits)
  if (!Number.isFinite(value)) {
    return null
  }
  return {
    value,
    groupSeparator,
    groupStyle,
    decimalSeparator,
    fractionDigits: fraction.length,
  }
}

/** Parses a printed amount such as "BDT 5,784.00", "(€1.234,50)" or "Tk. 5,784/-". */
export function parseAmount(raw: string): ParsedAmount | null {
  let text = raw.trim()
  if (!text) {
    return null
  }

  let negativeStyle: NegativeStyle | null = null
  if (/^\(.*\)$/.test(text)) {
    negativeStyle = 'parentheses'
    text = text.slice(1, -1).trim()
  }
  if (/^[-−–]/.test(text)) {
    negativeStyle = negativeStyle ?? 'minus'
    text = text.slice(1).trim()
  }

  let trailingMark = ''
  const trailing = /(\/-|\/=|\.-|,-)$/.exec(text)
  if (trailing) {
    trailingMark = trailing[1]!
    text = text.slice(0, -trailingMark.length)
  } else if (/\d-$/.test(text)) {
    negativeStyle = negativeStyle ?? 'trailing_minus'
    text = text.slice(0, -1)
  }

  let currency: string | null = null
  let currencyPosition: ParsedAmount['currencyPosition'] = null
  let currencyGap = ''
  const leading = LEADING_CURRENCY_RE.exec(text)
  if (leading) {
    currency = leading[1]!
    currencyGap = leading[2] ?? ''
    currencyPosition = 'prefix'
    text = text.slice(leading[0].length)
    if (/^[-−–]/.test(text)) {
      negativeStyle = negativeStyle ?? 'minus'
      text = text.slice(1).trim()
    }
  } else {
    const trailingCurrency = TRAILING_CURRENCY_RE.exec(text)
    if (trailingCurrency) {
      currency = trailingCurrency[2]!
      currencyGap = trailingCurrency[1] ?? ''
      currencyPosition = 'suffix'
      text = text.slice(0, text.length - trailingCurrency[0].length)
    }
  }

  const shape = parseNumberShape(text)
  if (!shape) {
    return null
  }
  return {
    raw: raw.trim(),
    value: negativeStyle ? -shape.value : shape.value,
    currency,
    currencyPosition,
    currencyGap,
    groupSeparator: shape.groupSeparator,
    groupStyle: shape.groupStyle,
    decimalSeparator: shape.decimalSeparator,
    fractionDigits: shape.fractionDigits,
    negativeStyle,
    trailingMark,
  }
}

function groupDigits(digits: string, separator: string, style: 'western' | 'indian'): string {
  if (digits.length <= 3) {
    return digits
  }
  if (style === 'indian') {
    const lastThree = digits.slice(-3)
    let head = digits.slice(0, -3)
    const parts: string[] = []
    while (head.length > 2) {
      parts.unshift(head.slice(-2))
      head = head.slice(0, -2)
    }
    if (head) {
      parts.unshift(head)
    }
    return [...parts, lastThree].join(separator)
  }
  const parts: string[] = []
  let rest = digits
  while (rest.length > 3) {
    parts.unshift(rest.slice(-3))
    rest = rest.slice(0, -3)
  }
  parts.unshift(rest)
  return parts.join(separator)
}

/** Formats `value` using the separators, currency, sign style and decimals of `template`. */
export function formatAmountLike(
  template: ParsedAmount,
  value: number,
  fractionDigits = template.fractionDigits,
): string {
  const magnitude = Math.abs(value)
  const fixed = magnitude.toFixed(fractionDigits)
  const [integerDigits = '0', fraction = ''] = fixed.split('.')
  // Amounts printed without separators stay that way, but long values gain grouping
  // only when the original already used it.
  const grouped = template.groupSeparator
    ? groupDigits(integerDigits, template.groupSeparator, template.groupStyle ?? 'western')
    : integerDigits
  const decimal = template.decimalSeparator ?? (template.groupSeparator === '.' ? ',' : '.')
  let number = fraction ? `${grouped}${decimal}${fraction}` : grouped

  const negative = value < 0
  const signStyle = template.negativeStyle ?? 'minus'
  if (negative && signStyle === 'trailing_minus') {
    number = `${number}-`
  }

  let body = number
  if (template.currency && template.currencyPosition === 'prefix') {
    body = `${template.currency}${template.currencyGap}${number}`
  } else if (template.currency && template.currencyPosition === 'suffix') {
    body = `${number}${template.currencyGap}${template.currency}`
  }

  if (negative && signStyle === 'minus') {
    body = template.currency && template.currencyPosition === 'prefix' && template.raw.search(/[-−–]/) > template.raw.indexOf(template.currency)
      ? `${template.currency}${template.currencyGap}-${number}`
      : `-${body}`
  } else if (negative && signStyle === 'parentheses') {
    body = `(${body})`
  }
  return `${body}${template.trailingMark}`
}

export interface ReplacementResolution {
  /** Text that will be drawn on the page. */
  readonly text: string
  readonly value: number | null
  readonly notes: readonly string[]
  readonly error: string | null
}

/**
 * Turns user input into display text. With `matchFormat`, "5884" for an original
 * "BDT 5,784.00" becomes "BDT 5,884.00"; otherwise the input is used verbatim.
 */
export function resolveReplacementInput(
  template: ParsedAmount,
  input: string,
  matchFormat: boolean,
): ReplacementResolution {
  const trimmed = input.trim()
  if (!trimmed) {
    return { text: '', value: null, notes: [], error: 'Enter a replacement value.' }
  }
  const parsed = parseAmount(trimmed) ?? parseLooseUserNumber(trimmed, template)
  if (!matchFormat) {
    return {
      text: trimmed,
      value: parsed?.value ?? null,
      notes: parsed ? [] : ['Replacement is not a number, so related-amount checks skip it.'],
      error: null,
    }
  }
  if (!parsed) {
    return {
      text: trimmed,
      value: null,
      notes: [],
      error: 'Could not read a number. Turn off “Match original format” to type the exact text.',
    }
  }

  const notes: string[] = []
  if (
    parsed.currency &&
    currencyCodeFor(parsed.currency) !== currencyCodeFor(template.currency)
  ) {
    notes.push(
      `Your input mentions ${parsed.currency}; the original currency marker${template.currency ? ` “${template.currency}”` : ' (none)'} is kept. Turn off “Match original format” to change it.`,
    )
  }
  let fractionDigits = template.fractionDigits
  if (parsed.fractionDigits > template.fractionDigits) {
    fractionDigits = parsed.fractionDigits
    notes.push(
      `The original shows ${template.fractionDigits} decimal place${template.fractionDigits === 1 ? '' : 's'}; your value keeps ${parsed.fractionDigits}.`,
    )
  }
  let value = parsed.value
  if (template.value < 0 && value > 0 && !parsed.negativeStyle) {
    value = -value
    notes.push('The original amount is negative, so the replacement keeps the negative sign.')
  }
  return { text: formatAmountLike(template, value, fractionDigits), value, notes, error: null }
}

/** User typing "5884.5" or "5.884,50": interpret with the template's decimal convention. */
function parseLooseUserNumber(input: string, template: ParsedAmount): ParsedAmount | null {
  const compact = input.replace(/\s/g, '')
  if (!/^[-−]?\d[\d.,']*$/.test(compact)) {
    return null
  }
  const negative = /^[-−]/.test(compact)
  const unsigned = compact.replace(/^[-−]/, '')
  const decimal = template.decimalSeparator ?? (template.groupSeparator === '.' ? ',' : '.')
  const groupChars = decimal === ',' ? /[.']/g : /[,']/g
  const normalized = unsigned.replace(groupChars, '')
  const parts = normalized.split(decimal)
  if (parts.length > 2) {
    return null
  }
  const fraction = parts[1] ?? ''
  const value = Number(`${parts[0]}${fraction ? `.${fraction}` : ''}`)
  if (!Number.isFinite(value)) {
    return null
  }
  return {
    raw: input,
    value: negative ? -value : value,
    currency: null,
    currencyPosition: null,
    currencyGap: '',
    groupSeparator: null,
    groupStyle: null,
    decimalSeparator: fraction ? decimal : null,
    fractionDigits: fraction.length,
    negativeStyle: negative ? 'minus' : null,
    trailingMark: '',
  }
}

/** Formats a value for messages using the candidate's own style. */
export function describeAmount(template: ParsedAmount, value: number): string {
  return formatAmountLike(template, value, Math.max(template.fractionDigits, decimalsNeeded(value)))
}

function decimalsNeeded(value: number): number {
  const rounded = Math.round(value * 100) / 100
  if (Number.isInteger(rounded)) {
    return 0
  }
  return Number.isInteger(rounded * 10) ? 1 : 2
}
