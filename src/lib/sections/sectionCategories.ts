import type { SectionCategoryId } from '@/types/documentSections'

export interface LabelPhrase {
  /** Regex source matched against normalized text (lowercase, `&` → `and`, punctuation → space). */
  readonly pattern: string
  readonly ambiguousWith?: readonly SectionCategoryId[]
}

export interface SectionCategoryDefinition {
  readonly id: SectionCategoryId
  readonly label: string
  /** `field` = single label/value line (fares); `block` = heading followed by content. */
  readonly scope: 'block' | 'field'
  readonly color: string
  readonly phrases: readonly LabelPhrase[]
}

export const SECTION_CATEGORIES: readonly SectionCategoryDefinition[] = [
  {
    id: 'passenger',
    label: 'Passenger Information',
    scope: 'block',
    color: '#2563eb',
    phrases: [
      { pattern: 'passengers? (?:information|info|details|names?|list|data)' },
      { pattern: 'passengers?' },
      { pattern: 'name of (?:the )?passengers?' },
      { pattern: 'lead passenger' },
      { pattern: 'travell?ers?(?: (?:information|info|details|names?))?' },
      { pattern: 'guests? (?:information|details|names?)' },
      { pattern: 'pax(?: (?:details|names?|information|info))?' },
    ],
  },
  {
    id: 'contact',
    label: 'Contact Information',
    scope: 'block',
    color: '#0891b2',
    phrases: [
      { pattern: 'contact(?: (?:information|info|details|us|number|person|no))?' },
      { pattern: 'emergency contact' },
      { pattern: 'customer (?:support|service|care)' },
      { pattern: 'help ?(?:line|desk)' },
      { pattern: '(?:tele)?phone(?: (?:number|no))?' },
      { pattern: 'mobile(?: (?:number|no))?' },
      { pattern: 'e ?mail(?: address)?' },
      { pattern: 'bill(?:ed)? to' },
      { pattern: 'billing (?:address|details|information)' },
    ],
  },
  {
    id: 'agency',
    label: 'Agency Information',
    scope: 'block',
    color: '#7c3aed',
    phrases: [
      { pattern: 'agency(?: (?:information|info|details|name|address))?' },
      { pattern: 'agency contact', ambiguousWith: ['contact'] },
      { pattern: 'travel agen(?:cy|t)(?: (?:information|info|details))?' },
      { pattern: 'issuing (?:agent|agency|office|airline)' },
      { pattern: 'agent(?: (?:information|info|details|name))?' },
      { pattern: '(?:issued|booked|sold) by' },
      { pattern: 'iata(?: (?:number|no|code))?' },
    ],
  },
  {
    id: 'flight',
    label: 'Flight Details',
    scope: 'block',
    color: '#0d9488',
    phrases: [
      {
        pattern:
          'flights?(?: (?:details|information|info|itinerary|schedule|segments?|summary))?',
      },
      { pattern: 'itinerary(?: (?:details|information|receipt))?' },
      { pattern: 'journey(?: (?:details|information))?' },
      { pattern: 'trip (?:details|information|summary)' },
      { pattern: 'travel (?:details|itinerary|information)' },
      { pattern: 'segments?' },
      { pattern: 'route(?: details)?' },
      { pattern: '(?:outbound|onward|return|inbound)(?: flights?| journey)?' },
      { pattern: 'departure(?: (?:details|information))?' },
    ],
  },
  {
    id: 'booking',
    label: 'Booking Information',
    scope: 'block',
    color: '#ca8a04',
    phrases: [
      {
        pattern:
          'booking(?: (?:reference|ref|details|information|info|id|no|number|code|status|date|summary))?',
      },
      { pattern: '(?:airline )?pnr(?: (?:no|number|code))?' },
      { pattern: 'reservation(?: (?:code|number|no|details|information|id))?' },
      { pattern: 'confirmation(?: (?:number|no|code))?' },
      { pattern: 'record locator' },
      { pattern: 'e ?tickets?(?: (?:number|no|receipt))?' },
      { pattern: 'tickets?(?: (?:number|no|details|information))?' },
      { pattern: 'order (?:number|no|id|details)' },
      { pattern: '(?:tax )?invoice(?: (?:number|no|date|details))?' },
      { pattern: 'date of issue|issue date|issued on' },
    ],
  },
  {
    id: 'base_fare',
    label: 'Base Fare',
    scope: 'field',
    color: '#16a34a',
    phrases: [
      { pattern: 'base fares?' },
      { pattern: 'basic fares?' },
      { pattern: 'net fares?' },
      { pattern: 'air ?fares?' },
      { pattern: 'equiv(?:alent)? fare(?: paid)?' },
      { pattern: 'fare amount', ambiguousWith: ['gross_fare'] },
      { pattern: 'fares?', ambiguousWith: ['gross_fare', 'total'] },
      { pattern: 'sub ?total', ambiguousWith: ['gross_fare'] },
    ],
  },
  {
    id: 'gross_fare',
    label: 'Gross Fare',
    scope: 'field',
    color: '#15803d',
    phrases: [
      { pattern: 'gross (?:fares?|amount|total|price)' },
      { pattern: 'gross' },
      { pattern: 'total fares?', ambiguousWith: ['total'] },
      { pattern: 'fare total', ambiguousWith: ['total'] },
    ],
  },
  {
    id: 'tax',
    label: 'Tax and Surcharge',
    scope: 'field',
    color: '#ea580c',
    phrases: [
      { pattern: 'tax(?:es)?(?: and (?:fees|surcharges?|charges))?' },
      { pattern: 'tax(?:es)? fees' },
      { pattern: 'total tax(?:es)?' },
      { pattern: '(?:fuel |carrier (?:imposed )?)?surcharges?' },
      { pattern: 'fees(?: and charges)?', ambiguousWith: ['total'] },
      { pattern: 'vat|gst' },
      { pattern: 'airport (?:tax|fee)s?' },
      { pattern: 'service (?:charge|fee)s?' },
    ],
  },
  {
    id: 'total',
    label: 'Total Price',
    scope: 'field',
    color: '#dc2626',
    phrases: [
      { pattern: 'total' },
      { pattern: 'grand total' },
      { pattern: 'total (?:price|amount|cost|payable|paid|due|charges?)' },
      { pattern: 'amount (?:due|paid|payable)' },
      { pattern: '(?:net|total) payable' },
      { pattern: 'balance due' },
      { pattern: 'total to pay|you paid' },
    ],
  },
  {
    id: 'baggage',
    label: 'Baggage Information',
    scope: 'block',
    color: '#9333ea',
    phrases: [
      { pattern: 'baggage(?: (?:allowance|information|info|details|policy))?' },
      { pattern: 'luggage(?: (?:allowance|information|details))?' },
      { pattern: '(?:checked|cabin|hand|carry on) (?:baggage|bags?|luggage)' },
      { pattern: 'free baggage(?: allowance)?' },
    ],
  },
  {
    id: 'terms',
    label: 'Terms and Conditions',
    scope: 'block',
    color: '#475569',
    phrases: [
      { pattern: 'terms(?: (?:and|of) (?:conditions|use|service|carriage))?' },
      { pattern: 't and cs?' },
      { pattern: 'conditions(?: of (?:carriage|contract|travel|sale))?' },
      { pattern: 'fare rules?' },
      { pattern: '(?:cancellation|refund|change|reissue) (?:policy|rules|charges|conditions)' },
      { pattern: 'important (?:information|notes?|notice|instructions)' },
      { pattern: 'notices?|disclaimer' },
      { pattern: 'general (?:information|conditions)' },
    ],
  },
  {
    id: 'other',
    label: 'Text block',
    scope: 'block',
    color: '#64748b',
    phrases: [],
  },
]

const CATEGORY_BY_ID = new Map(SECTION_CATEGORIES.map((category) => [category.id, category]))

export function getSectionCategory(id: SectionCategoryId): SectionCategoryDefinition {
  return CATEGORY_BY_ID.get(id) ?? SECTION_CATEGORIES[SECTION_CATEGORIES.length - 1]!
}
