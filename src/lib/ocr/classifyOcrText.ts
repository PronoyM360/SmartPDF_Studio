import type { OcrTextTag } from '@/types/ocr'

const PRICE_PATTERN =
  /^(\$|€|£|¥|৳|USD|EUR|GBP)?\s*[\d,]+([.]\d{1,2})?\s*($|USD|EUR|GBP)?$/i

const QUANTITY_PATTERN = /^(qty|quantity|x|×)\s*[:.]?\s*\d+$/i

const SHORT_NUMBER_PATTERN = /^\d{1,6}([.]\d{1,2})?$/

export function classifyOcrTextTags(text: string): OcrTextTag[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }
  const tags: OcrTextTag[] = []
  if (PRICE_PATTERN.test(trimmed)) {
    tags.push('price')
  }
  if (QUANTITY_PATTERN.test(trimmed)) {
    tags.push('quantity')
  }
  if (
    tags.length === 0 &&
    SHORT_NUMBER_PATTERN.test(trimmed) &&
    trimmed.length <= 8
  ) {
    tags.push('price')
  }
  return tags
}

export function countTaggedItems(
  items: readonly { tags: readonly OcrTextTag[] }[],
  tag: OcrTextTag,
): number {
  return items.filter((item) => item.tags.includes(tag)).length
}
