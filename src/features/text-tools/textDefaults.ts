import type { TextOverlayObject } from '@/types/textOverlay'

export const TEXT_FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Calibri',
  'Cambria',
  'Roboto',
  'Open Sans',
  'Segoe UI',
  'Inter',
] as const

export const DEFAULT_TEXT_FONT_FAMILY = 'Arial'
/** Smallest text box size allowed in the editor (PDF points). */
export const MIN_TEXT_BOX_WIDTH_PT = 8
export const MIN_TEXT_BOX_HEIGHT_PT = 4
export const DEFAULT_TEXT_FONT_SIZE = 14
export const DEFAULT_TEXT_COLOR = '#0f172a'
export const DEFAULT_TEXT_BOX_WIDTH = 200
export const DEFAULT_TEXT_BOX_HEIGHT = 48
export const DEFAULT_TEXT_CONTENT = 'Add text'

export function createTextOverlayObject(
  pageIndex: number,
  bounds: TextOverlayObject['bounds'],
): TextOverlayObject {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    kind: 'text',
    pageIndex,
    bounds,
    content: DEFAULT_TEXT_CONTENT,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    color: DEFAULT_TEXT_COLOR,
    alignment: 'left',
    createdAt: now,
    updatedAt: now,
  }
}
