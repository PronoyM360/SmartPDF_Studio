import { TEXT_FONT_FAMILIES } from '@/features/text-tools/textDefaults'
import {
  mapPdfFontName,
  pdfFontNameIncludesUsSuffix,
  pdfFontNameToCssFamily,
} from '@/lib/pdf/mapPdfFontName'

export interface FontFamilySelectOption {
  readonly value: string
  readonly label: string
}

export function buildTextFontFamilyOptions(input: {
  pdfFontName?: string | null
  selectedFamily?: string
}): FontFamilySelectOption[] {
  const options: FontFamilySelectOption[] = []
  const seen = new Set<string>()

  const add = (value: string, label?: string): void => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    options.push({ value: trimmed, label: label ?? trimmed })
  }

  if (input.pdfFontName) {
    const cssFamily = pdfFontNameToCssFamily(input.pdfFontName)
    const mapped = mapPdfFontName(input.pdfFontName)
    if (cssFamily) {
      const usTag = pdfFontNameIncludesUsSuffix(input.pdfFontName) ? ' (US)' : ''
      add(cssFamily, `From PDF${usTag}: ${cssFamily}`)
    }
    if (mapped.family !== cssFamily) {
      add(
        mapped.family,
        mapped.isExactFamilyMatch
          ? `${mapped.family} (PDF match)`
          : `${mapped.family} (closest web font)`,
      )
    }
  }

  for (const family of TEXT_FONT_FAMILIES) {
    add(family)
  }

  if (input.selectedFamily) {
    add(input.selectedFamily)
  }

  return options
}
