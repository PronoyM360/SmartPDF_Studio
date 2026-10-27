import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  cloneOverlayObjects,
  createInitialHistoryState,
  historyCommit,
  historyRedo,
  historyUndo,
  type EditorHistoryState,
} from '@/features/pdf-editor/editorHistory'
import { computeImageBoundsAtPoint } from '@/features/image-tools/imagePlacement'
import {
  readImageDimensions,
  validateImageFile,
} from '@/features/image-tools/validateImageFile'
import {
  createMaskObject,
  mergeTextCorrections,
  prepareTextCorrections,
  type OverlayTextCorrectionInput,
} from '@/features/pdf-editor/textCorrectionOverlays'
import { createTextOverlayObject } from '@/features/text-tools/textDefaults'
import { toUserFacingPdfError } from '@/lib/pdf'
import type { EditorToolId } from '@/types'
import type { PagePoint, PageRect } from '@/types'
import type { ImageOverlayObject, ImageOverlayPatch } from '@/types/imageOverlay'
import type { MaskMode, MaskOverlayObject, MaskOverlayPatch } from '@/types/maskOverlay'
import type { OverlayObject } from '@/types/overlayObjects'
import type { TextOverlayObject, TextOverlayPatch } from '@/types/textOverlay'

export interface ImageAssetRecord {
  readonly id: string
  readonly blobUrl: string
  readonly mimeType: string
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly bytes: Uint8Array
}

interface EditorSessionContextValue {
  activeToolId: EditorToolId
  setActiveToolId: (toolId: EditorToolId) => void
  overlayObjects: readonly OverlayObject[]
  selectedObjectId: string | null
  selectObject: (id: string | null) => void
  editingObjectId: string | null
  setEditingObjectId: (id: string | null) => void
  maskEyedropperActive: boolean
  setMaskEyedropperActive: (active: boolean) => void
  pendingImageAssetId: string | null
  imageIngestError: string | null
  clearImageIngestError: () => void
  ingestImageFile: (file: File) => Promise<boolean>
  addTextObjectAtPdfPoint: (pageIndex: number, pdfPoint: PagePoint) => TextOverlayObject
  addImageObjectAtPdfPoint: (
    pageIndex: number,
    pdfPoint: PagePoint,
    assetId: string,
  ) => ImageOverlayObject | null
  addMaskObjectWithBounds: (
    pageIndex: number,
    bounds: PageRect,
  ) => MaskOverlayObject
  /** Adds several masks as one undo step. */
  addMaskObjectsWithBounds: (entries: readonly NewMaskInput[]) => MaskOverlayObject[]
  /** Removes overlays by id as one undo step. */
  deleteOverlayObjects: (ids: readonly string[]) => void
  updateTextObject: (
    id: string,
    patch: TextOverlayPatch,
    options?: { recordHistory?: boolean },
  ) => void
  updateImageObject: (
    id: string,
    patch: ImageOverlayPatch,
    options?: { recordHistory?: boolean },
  ) => void
  updateMaskObject: (
    id: string,
    patch: MaskOverlayPatch,
    options?: { recordHistory?: boolean },
  ) => void
  deleteSelectedObject: () => void
  duplicateSelectedObject: () => void
  getSelectedObject: () => OverlayObject | undefined
  getImageAsset: (assetId: string) => ImageAssetRecord | undefined
  getImageAssetBytes: (assetId: string) => Uint8Array | undefined
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** Records the current overlay snapshot as one undo step (after live property edits). */
  commitOverlayHistoryStep: () => void
  applyOverlayTextCorrection: (input: OverlayTextCorrectionInput) => void
  /** Applies multiple overlay corrections in one undo step (e.g. Replace All). */
  applyOverlayTextCorrections: (inputs: readonly OverlayTextCorrectionInput[]) => void
  getImageAssetIds: () => string[]
  collectImageAssetBytes: () => Record<string, Uint8Array>
}

export type { OverlayTextCorrectionInput }

const EditorSessionContext = createContext<EditorSessionContextValue | null>(null)

export interface RestoredImageAsset {
  readonly id: string
  readonly mimeType: string
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly bytes: Uint8Array
}

export interface RestoredEditorSession {
  readonly overlayObjects: OverlayObject[]
  readonly imageAssets: readonly RestoredImageAsset[]
}

interface EditorSessionProviderProps {
  documentId: string
  activePageIndex: number
  restoredSession?: RestoredEditorSession | null
  children: ReactNode
}

export interface NewMaskInput {
  pageIndex: number
  bounds: PageRect
  fillColor?: string
  mode?: MaskMode
  label?: string
  sourceSectionId?: string
}

export function EditorSessionProvider({
  documentId,
  activePageIndex,
  restoredSession = null,
  children,
}: EditorSessionProviderProps) {
  const [activeToolId, setActiveToolId] = useState<EditorToolId>('select')
  const [history, setHistory] = useState<EditorHistoryState>(() => {
    if (restoredSession?.overlayObjects.length) {
      return {
        past: [],
        present: cloneOverlayObjects(restoredSession.overlayObjects),
        future: [],
      }
    }
    return createInitialHistoryState()
  })
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null)
  const [maskEyedropperActive, setMaskEyedropperActive] = useState(false)
  const [pendingImageAssetId, setPendingImageAssetId] = useState<string | null>(
    null,
  )
  const [imageIngestError, setImageIngestError] = useState<string | null>(null)
  const imageAssetsRef = useRef<Map<string, ImageAssetRecord>>(new Map())
  /** Last overlay snapshot included in the undo stack (for batched property edits). */
  const committedPresentRef = useRef<OverlayObject[]>([])

  const overlayObjects = history.present

  const syncCommittedPresent = useCallback((objects: OverlayObject[]) => {
    committedPresentRef.current = cloneOverlayObjects(objects)
  }, [])

  const applyOverlayUpdate = useCallback(
    (updater: (current: OverlayObject[]) => OverlayObject[], recordHistory = true) => {
      setHistory((state) => {
        const next = updater(state.present)
        if (!recordHistory) {
          return { ...state, present: cloneOverlayObjects(next) }
        }
        const committed = historyCommit(state, next)
        committedPresentRef.current = cloneOverlayObjects(committed.present)
        return committed
      })
    },
    [],
  )

  const releaseAllAssets = useCallback((): void => {
    for (const asset of imageAssetsRef.current.values()) {
      URL.revokeObjectURL(asset.blobUrl)
    }
    imageAssetsRef.current.clear()
  }, [])

  const restoredForDocumentRef = useRef<string | null>(null)

  useEffect(() => {
    releaseAllAssets()
    const initial = createInitialHistoryState()
    setHistory(initial)
    syncCommittedPresent(initial.present)
    setSelectedObjectId(null)
    setEditingObjectId(null)
    setActiveToolId('select')
    setPendingImageAssetId(null)
    setMaskEyedropperActive(false)
    setImageIngestError(null)
    restoredForDocumentRef.current = null
  }, [documentId, releaseAllAssets, syncCommittedPresent])

  useEffect(() => {
    if (!restoredSession || restoredForDocumentRef.current === documentId) {
      return
    }
    restoredForDocumentRef.current = documentId
    const restored = {
      past: [],
      present: cloneOverlayObjects(restoredSession.overlayObjects),
      future: [],
    }
    setHistory(restored)
    syncCommittedPresent(restored.present)
    for (const asset of restoredSession.imageAssets) {
      const blobBytes = asset.bytes.slice()
      const blobUrl = URL.createObjectURL(
        new Blob([blobBytes], { type: asset.mimeType }),
      )
      imageAssetsRef.current.set(asset.id, {
        id: asset.id,
        blobUrl,
        mimeType: asset.mimeType,
        pixelWidth: asset.pixelWidth,
        pixelHeight: asset.pixelHeight,
        bytes: asset.bytes,
      })
    }
  }, [documentId, restoredSession])

  useEffect(() => {
    return () => releaseAllAssets()
  }, [releaseAllAssets])

  useEffect(() => {
    if (!selectedObjectId) {
      return
    }
    const selected = overlayObjects.find((object) => object.id === selectedObjectId)
    if (!selected) {
      setSelectedObjectId(null)
      setEditingObjectId(null)
      return
    }
    if (selected.pageIndex !== activePageIndex) {
      setSelectedObjectId(null)
      setEditingObjectId(null)
    }
  }, [activePageIndex, selectedObjectId, overlayObjects])

  const selectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
    if (id) {
      setEditingObjectId(null)
    }
  }, [])

  const clearImageIngestError = useCallback(() => setImageIngestError(null), [])

  const ingestImageFile = useCallback(async (file: File): Promise<boolean> => {
    setImageIngestError(null)
    try {
      await validateImageFile(file)
      const dimensions = await readImageDimensions(file)
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const blobUrl = URL.createObjectURL(file)
      const asset: ImageAssetRecord = {
        id: crypto.randomUUID(),
        blobUrl,
        mimeType: file.type || 'image/png',
        pixelWidth: dimensions.width,
        pixelHeight: dimensions.height,
        bytes,
      }
      imageAssetsRef.current.set(asset.id, asset)
      setPendingImageAssetId(asset.id)
      setActiveToolId('image')
      return true
    } catch (cause) {
      setImageIngestError(toUserFacingPdfError(cause).message)
      return false
    }
  }, [])

  const getImageAsset = useCallback((assetId: string): ImageAssetRecord | undefined => {
    return imageAssetsRef.current.get(assetId)
  }, [])

  const getImageAssetBytes = useCallback((assetId: string): Uint8Array | undefined => {
    return imageAssetsRef.current.get(assetId)?.bytes
  }, [])

  const getImageAssetIds = useCallback((): string[] => {
    return [...imageAssetsRef.current.keys()]
  }, [])

  const collectImageAssetBytes = useCallback((): Record<string, Uint8Array> => {
    const map: Record<string, Uint8Array> = {}
    for (const [id, asset] of imageAssetsRef.current.entries()) {
      map[id] = asset.bytes
    }
    return map
  }, [])

  const addTextObjectAtPdfPoint = useCallback(
    (pageIndex: number, pdfPoint: PagePoint): TextOverlayObject => {
      const bounds: PageRect = {
        x: pdfPoint.x,
        y: pdfPoint.y,
        width: 200,
        height: 48,
      }
      const created = createTextOverlayObject(pageIndex, bounds)
      applyOverlayUpdate((prev) => [...prev, created])
      setSelectedObjectId(created.id)
      setEditingObjectId(created.id)
      setActiveToolId('select')
      return created
    },
    [applyOverlayUpdate],
  )

  const addImageObjectAtPdfPoint = useCallback(
    (
      pageIndex: number,
      pdfPoint: PagePoint,
      assetId: string,
    ): ImageOverlayObject | null => {
      const asset = imageAssetsRef.current.get(assetId)
      if (!asset) {
        return null
      }
      const bounds = computeImageBoundsAtPoint(
        pdfPoint,
        asset.pixelWidth,
        asset.pixelHeight,
      )
      const now = Date.now()
      const created: ImageOverlayObject = {
        id: crypto.randomUUID(),
        kind: 'image',
        pageIndex,
        bounds,
        assetId,
        rotation: 0,
        lockAspectRatio: true,
        createdAt: now,
        updatedAt: now,
      }
      applyOverlayUpdate((prev) => [...prev, created])
      setSelectedObjectId(created.id)
      setActiveToolId('select')
      return created
    },
    [applyOverlayUpdate],
  )

  const addMaskObjectWithBounds = useCallback(
    (pageIndex: number, bounds: PageRect): MaskOverlayObject => {
      const created = createMaskObject(pageIndex, bounds)
      applyOverlayUpdate((prev) => [...prev, created])
      setSelectedObjectId(created.id)
      setActiveToolId('select')
      return created
    },
    [applyOverlayUpdate],
  )

  const addMaskObjectsWithBounds = useCallback(
    (entries: readonly NewMaskInput[]): MaskOverlayObject[] => {
      const created = entries.map((entry) =>
        createMaskObject(entry.pageIndex, entry.bounds, entry.fillColor, 1, entry),
      )
      if (created.length === 0) {
        return created
      }
      applyOverlayUpdate((prev) => [...prev, ...created])
      setSelectedObjectId(null)
      setActiveToolId('select')
      return created
    },
    [applyOverlayUpdate],
  )

  const deleteOverlayObjects = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) {
        return
      }
      const remove = new Set(ids)
      applyOverlayUpdate((prev) => prev.filter((object) => !remove.has(object.id)))
      setSelectedObjectId((prev) => (prev && remove.has(prev) ? null : prev))
      setEditingObjectId((prev) => (prev && remove.has(prev) ? null : prev))
    },
    [applyOverlayUpdate],
  )

  const applyOverlayTextCorrections = useCallback(
    (inputs: readonly OverlayTextCorrectionInput[]): void => {
      if (inputs.length === 0) {
        return
      }
      const prepared = prepareTextCorrections(inputs)
      applyOverlayUpdate((prev) => mergeTextCorrections(prev, prepared))
      setSelectedObjectId(prepared.added[prepared.added.length - 1]?.id ?? null)
      setEditingObjectId(null)
      setActiveToolId('select')
    },
    [applyOverlayUpdate],
  )

  const applyOverlayTextCorrection = useCallback(
    (input: OverlayTextCorrectionInput): void => applyOverlayTextCorrections([input]),
    [applyOverlayTextCorrections],
  )

  const updateObjectById = useCallback(
    (
      id: string,
      patch: Record<string, unknown>,
      options?: { recordHistory?: boolean },
    ) => {
      const recordHistory = options?.recordHistory ?? true
      applyOverlayUpdate(
        (prev) =>
          prev.map((object) =>
            object.id === id
              ? ({ ...object, ...patch, updatedAt: Date.now() } as OverlayObject)
              : object,
          ),
        recordHistory,
      )
    },
    [applyOverlayUpdate],
  )

  const commitOverlayHistoryStep = useCallback(() => {
    setHistory((state) => {
      const nextPresent = cloneOverlayObjects(state.present)
      const baseline = committedPresentRef.current
      const unchanged =
        baseline.length === nextPresent.length &&
        baseline.every((object, index) => {
          const other = nextPresent[index]
          return other && object.id === other.id && object.updatedAt === other.updatedAt
        })
      if (unchanged) {
        return state
      }
      committedPresentRef.current = cloneOverlayObjects(nextPresent)
      return {
        past: [...state.past, cloneOverlayObjects(baseline)],
        present: nextPresent,
        future: [],
      }
    })
  }, [])

  const updateTextObject = useCallback(
    (id: string, patch: TextOverlayPatch, options?: { recordHistory?: boolean }) =>
      updateObjectById(id, patch, options),
    [updateObjectById],
  )

  const updateImageObject = useCallback(
    (id: string, patch: ImageOverlayPatch, options?: { recordHistory?: boolean }) =>
      updateObjectById(id, patch, options),
    [updateObjectById],
  )

  const updateMaskObject = useCallback(
    (id: string, patch: MaskOverlayPatch, options?: { recordHistory?: boolean }) =>
      updateObjectById(id, patch, options),
    [updateObjectById],
  )

  const deleteSelectedObject = useCallback(() => {
    if (!selectedObjectId) {
      return
    }
    const id = selectedObjectId
    applyOverlayUpdate((prev) => prev.filter((object) => object.id !== id))
    setSelectedObjectId(null)
    setEditingObjectId(null)
  }, [selectedObjectId, applyOverlayUpdate])

  const duplicateSelectedObject = useCallback(() => {
    if (!selectedObjectId) {
      return
    }
    let copyId: string | null = null
    applyOverlayUpdate((prev) => {
      const source = prev.find((object) => object.id === selectedObjectId)
      if (!source) {
        return prev
      }
      const now = Date.now()
      const copy = {
        ...source,
        id: crypto.randomUUID(),
        bounds: {
          ...source.bounds,
          x: source.bounds.x + 16,
          y: source.bounds.y + 16,
        },
        createdAt: now,
        updatedAt: now,
      } as OverlayObject
      copyId = copy.id
      return [...prev, copy]
    })
    if (copyId) {
      setSelectedObjectId(copyId)
      setEditingObjectId(null)
    }
  }, [selectedObjectId, applyOverlayUpdate])

  const getSelectedObject = useCallback((): OverlayObject | undefined => {
    return overlayObjects.find((object) => object.id === selectedObjectId)
  }, [overlayObjects, selectedObjectId])

  const undo = useCallback(() => {
    setHistory((state) => {
      const next = historyUndo(state)
      committedPresentRef.current = cloneOverlayObjects(next.present)
      return next
    })
    setEditingObjectId(null)
  }, [])

  const redo = useCallback(() => {
    setHistory((state) => {
      const next = historyRedo(state)
      committedPresentRef.current = cloneOverlayObjects(next.present)
      return next
    })
    setEditingObjectId(null)
  }, [])

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const value = useMemo<EditorSessionContextValue>(
    () => ({
      activeToolId,
      setActiveToolId,
      overlayObjects,
      selectedObjectId,
      selectObject,
      editingObjectId,
      setEditingObjectId,
      maskEyedropperActive,
      setMaskEyedropperActive,
      pendingImageAssetId,
      imageIngestError,
      clearImageIngestError,
      ingestImageFile,
      addTextObjectAtPdfPoint,
      addImageObjectAtPdfPoint,
      addMaskObjectWithBounds,
      addMaskObjectsWithBounds,
      deleteOverlayObjects,
      updateTextObject,
      updateImageObject,
      updateMaskObject,
      deleteSelectedObject,
      duplicateSelectedObject,
      getSelectedObject,
      getImageAsset,
      getImageAssetBytes,
      canUndo,
      canRedo,
      undo,
      redo,
      commitOverlayHistoryStep,
      applyOverlayTextCorrection,
      applyOverlayTextCorrections,
      getImageAssetIds,
      collectImageAssetBytes,
    }),
    [
      activeToolId,
      overlayObjects,
      selectedObjectId,
      selectObject,
      editingObjectId,
      maskEyedropperActive,
      pendingImageAssetId,
      imageIngestError,
      clearImageIngestError,
      ingestImageFile,
      addTextObjectAtPdfPoint,
      addImageObjectAtPdfPoint,
      addMaskObjectWithBounds,
      addMaskObjectsWithBounds,
      deleteOverlayObjects,
      updateTextObject,
      updateImageObject,
      updateMaskObject,
      deleteSelectedObject,
      duplicateSelectedObject,
      getSelectedObject,
      getImageAsset,
      getImageAssetBytes,
      canUndo,
      canRedo,
      undo,
      redo,
      commitOverlayHistoryStep,
      applyOverlayTextCorrection,
      applyOverlayTextCorrections,
      getImageAssetIds,
      collectImageAssetBytes,
    ],
  )

  return (
    <EditorSessionContext.Provider value={value}>
      {children}
    </EditorSessionContext.Provider>
  )
}

export function useEditorSession(): EditorSessionContextValue {
  const context = useContext(EditorSessionContext)
  if (!context) {
    throw new Error('useEditorSession must be used within EditorSessionProvider')
  }
  return context
}
