import { MIN_NEEDLE_LENGTH, scanPdfForText, type TextLeak } from './scanPdfForText'
import type { OpenPdfInspector, PageTextRun, RedactionArea } from './types'
import type { PageRect } from '@/types'

/** Rendered pixels inside a redaction that must match the fill colour. */
export const MIN_FILL_COVERAGE = 0.98

export interface RedactedPageRecord {
  readonly pageIndex: number
  readonly areas: readonly RedactionArea[]
  /** Text that was inside the areas in the source PDF. */
  readonly needles: readonly string[]
}

export interface RedactionVerification {
  /** All checks passed; only then may the export be described as redacted. */
  readonly ok: boolean
  readonly pagesWithTextLayer: readonly number[]
  /** null when rendering was unavailable in this environment. */
  readonly fillCoverage: readonly { pageIndex: number; coverage: number | null }[]
  /** Redacted strings found in the file that are not explained by visible text elsewhere. */
  readonly hiddenLeaks: readonly TextLeak[]
  /** Redacted strings still visible as text on pages that were not redacted. */
  readonly visibleElsewhere: readonly { needle: string; pageIndex: number }[]
  readonly checkedNeedleCount: number
}

function centerInside(run: PageRect, area: PageRect): boolean {
  const cx = run.x + run.width / 2
  const cy = run.y + run.height / 2
  return cx >= area.x && cx <= area.x + area.width && cy >= area.y && cy <= area.y + area.height
}

const HAS_LETTER = /[\p{L}@]/u

/**
 * Strings that were inside the redaction areas: whole runs plus distinctive words.
 * Number-only strings are skipped: content streams are full of numeric operands, so
 * they would match drawing commands. The text-layer check still covers them.
 */
export function collectRedactionNeedles(
  runs: readonly PageTextRun[],
  areas: readonly RedactionArea[],
): string[] {
  const needles = new Set<string>()
  for (const run of runs) {
    if (!areas.some((area) => centerInside(run.bounds, area.bounds))) {
      continue
    }
    const text = run.text.replace(/\s+/g, ' ').trim()
    if (text.length >= MIN_NEEDLE_LENGTH && HAS_LETTER.test(text)) {
      needles.add(text)
    }
    for (const word of text.split(/[\s,;·|]+/)) {
      const cleaned = word.replace(/^[^\p{L}\p{N}@+]+|[^\p{L}\p{N}]+$/gu, '')
      if (!HAS_LETTER.test(cleaned)) {
        continue
      }
      if (cleaned.length >= 6 || (cleaned.length >= MIN_NEEDLE_LENGTH && /[\d@]/.test(cleaned))) {
        needles.add(cleaned)
      }
    }
  }
  return [...needles]
}

/**
 * Reopens the exported bytes and checks that redacted pages have no text layer,
 * that the redacted areas render as filled, and that the redacted strings are not
 * present anywhere in the file (other than as visible text on unredacted pages).
 */
export async function verifyRedactedExport(input: {
  exportedBytes: Uint8Array
  pages: readonly RedactedPageRecord[]
  openInspector: OpenPdfInspector
  /** Text the export itself drew on a page (the modified-copy notice); not original content. */
  addedTextByPage?: ReadonlyMap<number, string>
}): Promise<RedactionVerification> {
  const inspector = await input.openInspector(input.exportedBytes.slice())
  try {
    const redactedIndices = new Set(input.pages.map((page) => page.pageIndex))
    const pagesWithTextLayer: number[] = []
    const fillCoverage: { pageIndex: number; coverage: number | null }[] = []

    for (const page of input.pages) {
      const runs = await inspector.readPageText(page.pageIndex)
      const added = input.addedTextByPage?.get(page.pageIndex)
      const original = runs.filter((run) => {
        const text = run.text.trim()
        return text.length > 0 && !(added && added.includes(text))
      })
      if (original.length > 0) {
        pagesWithTextLayer.push(page.pageIndex)
      }
      for (const area of page.areas) {
        const coverage = await inspector.measureFillCoverage(
          page.pageIndex,
          area.bounds,
          area.fillColor,
        )
        fillCoverage.push({ pageIndex: page.pageIndex, coverage })
      }
    }

    const needles = [...new Set(input.pages.flatMap((page) => page.needles))]
    const visibleElsewhere: { needle: string; pageIndex: number }[] = []
    if (needles.length > 0) {
      for (let pageIndex = 0; pageIndex < inspector.pageCount; pageIndex += 1) {
        if (redactedIndices.has(pageIndex)) {
          continue
        }
        const pageText = (await inspector.readPageText(pageIndex))
          .map((run) => run.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .toLowerCase()
        for (const needle of needles) {
          if (pageText.includes(needle.toLowerCase())) {
            visibleElsewhere.push({ needle, pageIndex })
          }
        }
      }
    }

    const explained = new Set(visibleElsewhere.map((entry) => entry.needle))
    const leaks = await scanPdfForText(input.exportedBytes, needles)
    const hiddenLeaks = leaks.filter((leak) => !explained.has(leak.needle))

    const coverageOk = fillCoverage.every(
      (entry) => entry.coverage === null || entry.coverage >= MIN_FILL_COVERAGE,
    )
    return {
      ok: pagesWithTextLayer.length === 0 && hiddenLeaks.length === 0 && coverageOk,
      pagesWithTextLayer,
      fillCoverage,
      hiddenLeaks,
      visibleElsewhere,
      checkedNeedleCount: needles.length,
    }
  } finally {
    await inspector.destroy()
  }
}
