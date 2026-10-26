import type { EditorToolDefinition } from '@/types'

export const EDITOR_TOOLS: readonly EditorToolDefinition[] = [
  {
    id: 'select',
    label: 'Select',
    description: 'Select, move, and resize text, image, and mask overlays (not native PDF text).',
    featureArea: 'pdf-editor',
  },
  {
    id: 'pan',
    label: 'Pan',
    description: 'Drag to move around the page.',
    featureArea: 'pdf-editor',
  },
  {
    id: 'text',
    label: 'Text',
    description: 'Add or edit text overlays.',
    featureArea: 'text-tools',
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Place images on the page.',
    featureArea: 'image-tools',
  },
  {
    id: 'highlight',
    label: 'Mask',
    description: 'Draw a visual cover over part of the page (not secure redaction).',
    featureArea: 'pdf-editor',
  },
  {
    id: 'export',
    label: 'Export',
    description: 'Download the modified PDF.',
    featureArea: 'export',
  },
]
