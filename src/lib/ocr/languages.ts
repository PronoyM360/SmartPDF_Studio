import type { OcrLanguagePackDefinition, OcrLanguagePackId } from '@/types/ocr'

export const OCR_LANGUAGE_PACKS: readonly OcrLanguagePackDefinition[] = [
  {
    id: 'eng',
    label: 'English',
    tesseractCode: 'eng',
    available: true,
  },
  {
    id: 'ben',
    label: 'Bangla (Bengali)',
    tesseractCode: 'ben',
    available: false,
    availabilityNote:
      'Bangla traineddata is not bundled yet. Add the language pack to enable recognition.',
  },
]

export function getOcrLanguagePack(
  id: OcrLanguagePackId,
): OcrLanguagePackDefinition {
  const pack = OCR_LANGUAGE_PACKS.find((entry) => entry.id === id)
  if (!pack) {
    return OCR_LANGUAGE_PACKS[0]!
  }
  return pack
}
