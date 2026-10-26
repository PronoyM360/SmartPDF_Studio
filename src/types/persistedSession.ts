import type { OverlayObject } from '@/types/overlayObjects'

export const PERSISTENCE_SCHEMA_VERSION = 1

export interface PersistedImageAssetMeta {
  readonly id: string
  readonly mimeType: string
  readonly pixelWidth: number
  readonly pixelHeight: number
}

export interface PersistedEditorSession {
  readonly schemaVersion: number
  readonly documentId: string
  readonly lastModifiedAt: string
  readonly documentName?: string
  readonly activePage: number
  readonly zoomPercent: number
  readonly fitMode: 'page' | 'width'
  readonly overlayObjects: OverlayObject[]
  readonly imageAssets: PersistedImageAssetMeta[]
}

export interface PersistedViewportState {
  readonly activePage: number
  readonly zoomPercent: number
  readonly fitMode: 'page' | 'width'
}
