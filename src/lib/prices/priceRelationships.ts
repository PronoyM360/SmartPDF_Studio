import { describeAmount } from '@/lib/prices/amountFormat'
import { isTotalLikeRole, PRICE_ROLE_LABELS } from '@/lib/prices/priceLabels'
import type { PriceCandidate } from '@/types/priceEditing'

/**
 * An arithmetic pattern that holds between printed amounts in the original file,
 * e.g. Base Fare + Tax = Total. Observed, not assumed: nothing is inferred from
 * the document type.
 */
export interface PriceRelationship {
  readonly id: string
  readonly kind: 'sum' | 'equal'
  readonly targetId: string
  /** Components with their sign (+1, or -1 for discounts). */
  readonly terms: readonly { readonly candidateId: string; readonly sign: 1 | -1 }[]
  readonly pageIndex: number
}

export interface PriceRelationshipWarning {
  readonly relationshipId: string
  readonly message: string
  /** Amounts the user may want to review (never changed automatically). */
  readonly relatedCandidateIds: readonly string[]
  readonly difference: number
}

const MAX_TERMS = 5
const MAX_COMPONENTS = 14

function tolerance(candidates: readonly PriceCandidate[]): number {
  const digits = Math.max(0, ...candidates.map((candidate) => candidate.amount.fractionDigits))
  return Math.max(0.005, 0.51 * 10 ** -digits * candidates.length)
}

function contribution(candidate: PriceCandidate, value: number): number {
  return candidate.role === 'discount' ? -Math.abs(value) : value
}

function* combinations<T>(items: readonly T[], size: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === size) {
    yield prefix
    return
  }
  for (let index = start; index < items.length; index += 1) {
    yield* combinations(items, size, index + 1, [...prefix, items[index]!])
  }
}

function label(candidate: PriceCandidate): string {
  return candidate.label ?? PRICE_ROLE_LABELS[candidate.role]
}

/** Finds sums and equalities that hold between the original amounts. */
export function findPriceRelationships(candidates: readonly PriceCandidate[]): PriceRelationship[] {
  const relationships: PriceRelationship[] = []
  const usable = candidates.filter((candidate) => candidate.editable || candidate.source === 'ocr')

  const pages = new Map<number, PriceCandidate[]>()
  for (const candidate of usable) {
    const list = pages.get(candidate.pageIndex) ?? []
    list.push(candidate)
    pages.set(candidate.pageIndex, list)
  }

  for (const [pageIndex, pageCandidates] of pages) {
    for (const target of pageCandidates.filter((candidate) => isTotalLikeRole(candidate.role))) {
      const components = pageCandidates
        .filter((candidate) => candidate.id !== target.id)
        .filter((candidate) => candidate.role !== 'amount_paid' && candidate.role !== 'total')
        .slice(0, MAX_COMPONENTS)
      const targetValue = target.amount.value
      for (let size = 2; size <= Math.min(MAX_TERMS, components.length); size += 1) {
        let found = false
        for (const combo of combinations(components, size)) {
          const sum = combo.reduce((acc, candidate) => acc + contribution(candidate, candidate.amount.value), 0)
          if (Math.abs(sum - targetValue) <= tolerance([target, ...combo])) {
            relationships.push({
              id: `sum:${target.id}:${combo.map((candidate) => candidate.id).join('+')}`,
              kind: 'sum',
              targetId: target.id,
              terms: combo.map((candidate) => ({
                candidateId: candidate.id,
                sign: candidate.role === 'discount' ? -1 : 1,
              })),
              pageIndex,
            })
            found = true
          }
        }
        // Keep the smallest explanation for each total.
        if (found) {
          break
        }
      }
    }
  }

  const totals = usable.filter((candidate) => candidate.role === 'total' || candidate.role === 'amount_paid')
  for (let i = 0; i < totals.length; i += 1) {
    for (let j = i + 1; j < totals.length; j += 1) {
      const a = totals[i]!
      const b = totals[j]!
      if (Math.abs(a.amount.value - b.amount.value) <= tolerance([a, b])) {
        relationships.push({
          id: `equal:${a.id}:${b.id}`,
          kind: 'equal',
          targetId: a.id,
          terms: [{ candidateId: b.id, sign: 1 }],
          pageIndex: a.pageIndex,
        })
      }
    }
  }
  return relationships
}

/**
 * Re-checks every relationship with edited values. Reports only patterns that held
 * before and no longer hold; it never proposes or applies new values.
 */
export function checkEditedRelationships(input: {
  candidates: readonly PriceCandidate[]
  relationships: readonly PriceRelationship[]
  /** candidateId → new numeric value (pending or committed). */
  editedValues: ReadonlyMap<string, number>
}): PriceRelationshipWarning[] {
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]))
  const valueOf = (candidate: PriceCandidate): number =>
    input.editedValues.get(candidate.id) ?? candidate.amount.value
  const warnings: PriceRelationshipWarning[] = []

  for (const relationship of input.relationships) {
    const target = byId.get(relationship.targetId)
    const terms = relationship.terms
      .map((term) => ({ candidate: byId.get(term.candidateId), sign: term.sign }))
      .filter((term): term is { candidate: PriceCandidate; sign: 1 | -1 } => Boolean(term.candidate))
    if (!target || terms.length !== relationship.terms.length) {
      continue
    }
    const members = [target, ...terms.map((term) => term.candidate)]
    if (!members.some((member) => input.editedValues.has(member.id))) {
      continue
    }

    const targetValue = valueOf(target)
    if (relationship.kind === 'equal') {
      const other = terms[0]!.candidate
      const otherValue = valueOf(other)
      const difference = otherValue - targetValue
      if (Math.abs(difference) > tolerance(members)) {
        warnings.push({
          relationshipId: relationship.id,
          message: `${label(target)} (${describeAmount(target.amount, targetValue)}) and ${label(other)} (${describeAmount(other.amount, otherValue)}) matched in the original but now differ.`,
          relatedCandidateIds: members.map((member) => member.id),
          difference,
        })
      }
      continue
    }

    const sum = terms.reduce((acc, term) => acc + contribution(term.candidate, valueOf(term.candidate)), 0)
    const difference = sum - targetValue
    if (Math.abs(difference) <= tolerance(members)) {
      continue
    }
    const expression = terms
      .map((term, index) => {
        const op = index === 0 ? (term.sign < 0 ? '− ' : '') : term.sign < 0 ? ' − ' : ' + '
        return `${op}${label(term.candidate)}`
      })
      .join('')
    warnings.push({
      relationshipId: relationship.id,
      message: `In the original, ${expression} = ${label(target)}. With your edit they add up to ${describeAmount(target.amount, sum)}, but ${label(target)} shows ${describeAmount(target.amount, targetValue)} (difference ${describeAmount(target.amount, Math.abs(difference))}). Review the related amounts; nothing was recalculated.`,
      relatedCandidateIds: members.map((member) => member.id),
      difference,
    })
  }
  return warnings
}

/** Same-page amounts worth reviewing when no arithmetic pattern links them. */
export function relatedAmountsOnPage(
  candidates: readonly PriceCandidate[],
  candidate: PriceCandidate,
): PriceCandidate[] {
  return candidates.filter(
    (other) => other.pageIndex === candidate.pageIndex && other.id !== candidate.id && other.role !== 'other',
  )
}
