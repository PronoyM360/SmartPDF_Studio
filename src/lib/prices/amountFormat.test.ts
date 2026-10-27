import { describe, expect, it } from 'vitest'
import {
  currencyCodeFor,
  formatAmountLike,
  parseAmount,
  resolveReplacementInput,
} from '@/lib/prices/amountFormat'

function parsed(raw: string) {
  const amount = parseAmount(raw)
  expect(amount, raw).not.toBeNull()
  return amount!
}

describe('parseAmount', () => {
  it.each([
    ['5784', 5784, null, 0],
    ['BDT 5,784.00', 5784, 'BDT', 2],
    ['$1,234.56', 1234.56, '$', 2],
    ['€1.234,56', 1234.56, '€', 2],
    ['2.300,50 €', 2300.5, '€', 2],
    ['1\u00a0234,56 €', 1234.56, '€', 2],
    ['Tk. 5,784/-', 5784, 'Tk.', 0],
    ['₹1,23,456.00', 123456, '₹', 2],
    ['($100.00)', -100, '$', 2],
    ['-৳ 200', -200, '৳', 0],
    ['USD155.50', 155.5, 'USD', 2],
    ['5,784.00 BDT', 5784, 'BDT', 2],
    ['£12.50', 12.5, '£', 2],
  ])('reads %s', (raw, value, currency, fractionDigits) => {
    const amount = parsed(raw)
    expect(amount.value).toBeCloseTo(value, 6)
    expect(amount.currency).toBe(currency)
    expect(amount.fractionDigits).toBe(fractionDigits)
  })

  it('rejects inconsistent grouping that looks like an identifier', () => {
    expect(parseAmount('12,34,5')).toBeNull()
    expect(parseAmount('1,2345')).toBeNull()
    expect(parseAmount('2026-0042')).toBeNull()
  })

  it('maps currency markers to ISO codes', () => {
    expect(currencyCodeFor('৳')).toBe('BDT')
    expect(currencyCodeFor('Tk.')).toBe('BDT')
    expect(currencyCodeFor('$')).toBe('USD')
    expect(currencyCodeFor('XYZ')).toBe('XYZ')
  })
})

describe('formatAmountLike', () => {
  it('keeps currency, spacing, grouping and decimals', () => {
    expect(formatAmountLike(parsed('BDT 5,784.00'), 5884)).toBe('BDT 5,884.00')
    expect(formatAmountLike(parsed('€1.234,56'), 9876.5)).toBe('€9.876,50')
    expect(formatAmountLike(parsed('2.300,50 €'), 2400)).toBe('2.400,00 €')
    expect(formatAmountLike(parsed('Tk. 5,784/-'), 5884)).toBe('Tk. 5,884/-')
    expect(formatAmountLike(parsed('5784'), 5884)).toBe('5884')
  })

  it('extends grouping for longer values and keeps Indian grouping', () => {
    expect(formatAmountLike(parsed('$1,234.56'), 1234567.8)).toBe('$1,234,567.80')
    expect(formatAmountLike(parsed('₹1,23,456.00'), 1234567)).toBe('₹12,34,567.00')
  })

  it('keeps the negative style', () => {
    expect(formatAmountLike(parsed('($100.00)'), -150)).toBe('($150.00)')
    expect(formatAmountLike(parsed('-৳ 200'), -250)).toBe('-৳ 250')
  })
})

describe('resolveReplacementInput', () => {
  it('formats a plain number like the original (5784 → 5884)', () => {
    const result = resolveReplacementInput(parsed('Gross Fare: 5784'.slice(12)), '5884', true)
    expect(result).toMatchObject({ text: '5884', value: 5884, error: null })
    expect(resolveReplacementInput(parsed('BDT 5,784.00'), '5884', true).text).toBe('BDT 5,884.00')
  })

  it('reads user input with the original decimal convention', () => {
    expect(resolveReplacementInput(parsed('€1.234,56'), '1234,5', true).text).toBe('€1.234,50')
    expect(resolveReplacementInput(parsed('$1,234.56'), '15,884.5', true).text).toBe('$15,884.50')
  })

  it('keeps extra decimals the user typed and says so', () => {
    const result = resolveReplacementInput(parsed('5784'), '5884.50', true)
    expect(result.text).toBe('5884.50')
    expect(result.notes.join(' ')).toMatch(/decimal/)
  })

  it('keeps the original currency and warns when the input names another', () => {
    const result = resolveReplacementInput(parsed('BDT 5,784'), 'USD 60', true)
    expect(result.text).toBe('BDT 60')
    expect(result.notes.join(' ')).toMatch(/USD/)
  })

  it('uses the input verbatim when format matching is off', () => {
    expect(resolveReplacementInput(parsed('BDT 5,784'), 'USD 60.00', false)).toMatchObject({
      text: 'USD 60.00',
      value: 60,
    })
  })

  it('reports non-numeric input instead of guessing', () => {
    const result = resolveReplacementInput(parsed('BDT 5,784'), 'five thousand', true)
    expect(result.error).toMatch(/Could not read a number/)
  })
})
