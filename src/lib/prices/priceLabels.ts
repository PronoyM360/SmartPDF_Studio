import { normalizeLabelText } from '@/lib/sections/classifySectionText'
import type { PriceRole } from '@/types/priceEditing'

export const PRICE_ROLE_LABELS: Record<PriceRole, string> = {
  base_fare: 'Base fare',
  gross_fare: 'Gross fare',
  net_fare: 'Net fare',
  tax: 'Tax',
  surcharge: 'Surcharge',
  service_charge: 'Service charge',
  discount: 'Discount',
  subtotal: 'Subtotal',
  total: 'Total price',
  amount_paid: 'Amount paid',
  other: 'Other price',
}

export const PRICE_ROLE_COLORS: Record<PriceRole, string> = {
  base_fare: '#2563eb',
  gross_fare: '#7c3aed',
  net_fare: '#0891b2',
  tax: '#d97706',
  surcharge: '#ea580c',
  service_charge: '#ca8a04',
  discount: '#16a34a',
  subtotal: '#4f46e5',
  total: '#dc2626',
  amount_paid: '#be123c',
  other: '#64748b',
}

/** Order matters: component words win over "total" ("Total Tax" is a tax). */
const ROLE_PATTERNS: readonly (readonly [PriceRole, RegExp])[] = [
  ['amount_paid', /\b(?:amount paid|paid amount|total paid|amount received|payment received|payment made|paid)\b/],
  ['subtotal', /\bsub ?total\b/],
  ['gross_fare', /\bgross\b/],
  ['net_fare', /\bnett?\b(?! payable)/],
  ['discount', /\b(?:discounts?|disc|promo(?:tion)?|rebate|coupon|voucher|deductions?|savings?|cash ?back|commission|less)\b/],
  ['tax', /\b(?:tax|taxes|vat|gst|hst|pst|duty|duties|levy|levies|airport fees?|embarkation(?: fees?)?|departure fees?|ait)\b/],
  ['surcharge', /\b(?:surcharges?|fuel|yq|yr|carrier imposed)\b/],
  ['service_charge', /\b(?:service (?:charges?|fees?)|convenience fees?|booking fees?|processing fees?|agency fees?|handling (?:fees?|charges?)|transaction fees?|issuance fees?|ticketing fees?|admin(?:istration)? fees?|fees?)\b/],
  ['total', /\b(?:grand total|total|payable|amount due|balance due|due|to pay|invoice amount)\b/],
  ['base_fare', /\b(?:base fare|basic fare|base price|base amount|air ?fare|fares?|equiv(?:alent)? fare)\b/],
  ['other', /\b(?:price|amount|charges?|cost|rate|sum|value|tariff|premium)\b/],
]

/** Quantities and measures: never money, even next to "total" ("Total passengers"). */
const COUNT_WORDS =
  /\b(?:passengers?|pax|persons?|people|travell?ers?|pieces?|pcs|bags?|baggage|luggage|weight|kgs?|lbs?|items?|qty|quantity|nights?|duration|time|miles|points|stops?|segments?|seats?|rooms?|adults?|child(?:ren)?|infants?)\b/

/** Identifiers that carry digits but are not prices (unless a price word is also present). */
const IDENTIFIER_WORDS =
  /\b(?:ticket|e ?ticket|etkt|tkt|pnr|booking|reservation|confirmation|locator|reference|ref|flight|flt|gate|terminal|passport|iata|phone|tel|telephone|mobile|cell|fax|whatsapp|page|invoice|order|customer|account|a c|card|zip|postal|postcode|pin|date|dob|issued|valid|class|frequent flyer|ffp|membership|member|document|receipt|transaction|serial|id|no|number|code|year|tin|bin|licen[cs]e)\b/

export type PriceLabelKind = 'price' | 'identifier' | 'count' | 'neutral'

export interface PriceLabelClassification {
  readonly kind: PriceLabelKind
  readonly role: PriceRole | null
  readonly matched: string | null
}

/** "Tax ID", "VAT Reg No", "Promo code": the label names an identifier of the price word. */
const IDENTIFIER_SUFFIX = /\b(?:id|no|nr|number|reg|registration|code|ref|reference)$/

export function classifyPriceLabel(text: string): PriceLabelClassification {
  const normalized = normalizeLabelText(text)
  if (!normalized || !/\p{L}/u.test(normalized)) {
    return { kind: 'neutral', role: null, matched: null }
  }
  const count = COUNT_WORDS.exec(normalized)
  if (count) {
    return { kind: 'count', role: null, matched: count[0] }
  }
  const suffix = IDENTIFIER_SUFFIX.exec(normalized)
  if (suffix) {
    return { kind: 'identifier', role: null, matched: suffix[0] }
  }
  for (const [role, pattern] of ROLE_PATTERNS) {
    const hit = pattern.exec(normalized)
    if (hit) {
      return { kind: 'price', role, matched: hit[0] }
    }
  }
  const identifier = IDENTIFIER_WORDS.exec(normalized)
  if (identifier) {
    return { kind: 'identifier', role: null, matched: identifier[0] }
  }
  return { kind: 'neutral', role: null, matched: null }
}

/** Trims separators around a label: "Gross Fare :" → "Gross Fare". */
export function cleanLabelText(text: string): string {
  return text
    .replace(/[\s:=\-–—.|·]+$/u, '')
    .replace(/^[\s:=\-–—.|·]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isTotalLikeRole(role: PriceRole): boolean {
  return (
    role === 'total' ||
    role === 'amount_paid' ||
    role === 'subtotal' ||
    role === 'gross_fare' ||
    role === 'net_fare'
  )
}
