import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { detectPriceCandidates } from '@/lib/prices/detectPriceCandidates'
import { createPriceSamplePdf } from '@/lib/prices/fixtures/createPriceSamplePdfs'
import {
  checkEditedRelationships,
  findPriceRelationships,
} from '@/lib/prices/priceRelationships'
import { pdfItemsToPriceRuns } from '@/lib/prices/priceTextRuns'
import type { PriceCandidate } from '@/types/priceEditing'

describe('price relationships', async () => {
  const data = await createPriceSamplePdf()
  const pdf = (await pdfjs.getDocument({ data, verbosity: 0 }).promise) as unknown as PDFDocumentProxy
  const { candidates } = detectPriceCandidates(pdfItemsToPriceRuns(await extractPageTextItems(pdf, 0)))
  const byLabel = (label: string): PriceCandidate => candidates.find((candidate) => candidate.label === label)!
  const relationships = findPriceRelationships(candidates)

  it('finds sums and equalities that hold in the original', () => {
    const gross = byLabel('Gross Fare')
    const total = byLabel('Total Price')
    const grossSum = relationships.find((entry) => entry.kind === 'sum' && entry.targetId === gross.id)
    expect(grossSum?.terms.map((term) => term.candidateId).sort()).toEqual(
      [byLabel('Base Fare').id, byLabel('Tax').id, byLabel('Service Charge').id].sort(),
    )
    const totalSum = relationships.find((entry) => entry.kind === 'sum' && entry.targetId === total.id)
    expect(totalSum?.terms).toEqual(
      expect.arrayContaining([
        { candidateId: gross.id, sign: 1 },
        { candidateId: byLabel('Discount').id, sign: -1 },
      ]),
    )
    expect(relationships.some((entry) => entry.kind === 'equal' && entry.terms[0]?.candidateId === byLabel('Amount Paid').id)).toBe(true)
  })

  it('has no warnings until an amount is edited', () => {
    expect(checkEditedRelationships({ candidates, relationships, editedValues: new Map() })).toEqual([])
  })

  it('warns when an edit breaks a sum and never proposes new values', () => {
    const gross = byLabel('Gross Fare')
    const warnings = checkEditedRelationships({
      candidates,
      relationships,
      editedValues: new Map([[gross.id, 5884]]),
    })
    const messages = warnings.map((warning) => warning.message).join('\n')
    expect(messages).toMatch(/Base Fare \+ Tax \+ Service Charge = Gross Fare/)
    expect(messages).toMatch(/Gross Fare − Discount = Total Price/)
    expect(messages).toMatch(/nothing was recalculated/)
    for (const warning of warnings) {
      expect(warning.relatedCandidateIds).toContain(gross.id)
    }
    expect(candidates.find((candidate) => candidate.id === byLabel('Total Price').id)?.amount.value).toBe(5684)
  })

  it('accepts edits that keep the original arithmetic consistent', () => {
    const editedValues = new Map([
      [byLabel('Base Fare').id, 5100],
      [byLabel('Gross Fare').id, 5884],
      [byLabel('Total Price').id, 5784],
      [byLabel('Amount Paid').id, 5784],
    ])
    expect(checkEditedRelationships({ candidates, relationships, editedValues })).toEqual([])
  })

  it('reports a broken equality between total and amount paid', () => {
    const warnings = checkEditedRelationships({
      candidates,
      relationships: relationships.filter((entry) => entry.kind === 'equal'),
      editedValues: new Map([[byLabel('Total Price').id, 5784]]),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/matched in the original but now differ/)
  })
})
