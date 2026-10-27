import type { PageRect } from '@/types'
import type {
  SectionCategoryId,
  SectionEvidence,
  SectionTextSource,
} from '@/types/documentSections'

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Deterministic ID so re-running detection on unchanged input yields the same IDs. */
export function stableSectionId(input: {
  pageIndex: number
  textSource: SectionTextSource
  category: SectionCategoryId
  evidence: SectionEvidence
  bounds: PageRect
}): string {
  const { bounds } = input
  const key = [
    input.pageIndex,
    input.textSource,
    input.category,
    input.evidence,
    Math.round(bounds.x),
    Math.round(bounds.y),
    Math.round(bounds.width),
    Math.round(bounds.height),
  ].join('|')
  return `sec-${input.pageIndex + 1}-${fnv1a(key)}`
}

export function manualSectionId(): string {
  return `manual-${crypto.randomUUID()}`
}
