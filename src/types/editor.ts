export type EditorToolId =
  | 'select'
  | 'pan'
  | 'text'
  | 'image'
  | 'highlight'
  | 'region'
  | 'export'

export interface EditorToolDefinition {
  readonly id: EditorToolId
  readonly label: string
  readonly description: string
  readonly featureArea:
    | 'pdf-editor'
    | 'text-tools'
    | 'image-tools'
    | 'export'
}

export interface EditorViewportState {
  readonly zoom: number
  readonly activeToolId: EditorToolId
  readonly selectedObjectId: string | null
}

export const DEFAULT_EDITOR_VIEWPORT: EditorViewportState = {
  zoom: 1,
  activeToolId: 'select',
  selectedObjectId: null,
}
