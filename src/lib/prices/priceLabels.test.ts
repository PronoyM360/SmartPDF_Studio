import { describe, expect, it } from 'vitest'
import { classifyPriceLabel } from '@/lib/prices/priceLabels'

describe('classifyPriceLabel', () => {
  it.each([
    ['Base Fare', 'base_fare'],
    ['BASIC FARE:', 'base_fare'],
    ['Gross Fare', 'gross_fare'],
    ['Net Fare', 'net_fare'],
    ['Taxes & Fees', 'tax'],
    ['VAT', 'tax'],
    ['Total Tax', 'tax'],
    ['Fuel Surcharge', 'surcharge'],
    ['Service Charge', 'service_charge'],
    ['Convenience fee', 'service_charge'],
    ['Discount', 'discount'],
    ['Promo discount', 'discount'],
    ['Sub-total', 'subtotal'],
    ['Total Price', 'total'],
    ['Grand Total', 'total'],
    ['Net Payable', 'total'],
    ['Amount Paid', 'amount_paid'],
    ['Ticket Price', 'other'],
  ])('%s → %s', (label, role) => {
    expect(classifyPriceLabel(label)).toMatchObject({ kind: 'price', role })
  })

  it.each(['Ticket Number', 'PNR', 'Booking Ref', 'Flight', 'Invoice No.', 'VAT Reg No', 'Promo code', 'Phone'])(
    '%s is an identifier',
    (label) => {
      expect(classifyPriceLabel(label).kind).toBe('identifier')
    },
  )

  it.each(['Total passengers', 'Baggage', 'Adult', 'Qty'])('%s is a quantity', (label) => {
    expect(classifyPriceLabel(label).kind).toBe('count')
  })
})
