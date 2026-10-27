import type Konva from 'konva'
import { useMemo, useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { sampleColorFromPdfCanvas } from '@/features/pdf-editor/samplePageColor'
import { ImageObjectNode } from '@/features/image-tools/ImageObjectNode'
import { MaskObjectNode } from '@/features/image-tools/MaskObjectNode'
import { TextInlineEditor } from '@/features/text-tools/TextInlineEditor'
import { TextObjectNode } from '@/features/text-tools/TextObjectNode'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import {
  createPageDisplayTransform,
  screenPointToPdfPoint,
  screenRectToPdfRect,
} from '@/lib/pdf'
import type { PageRect } from '@/types'
import {
  overlayManipulationEnabled,
  overlayObjectsListen,
  overlaySelectionEnabled,
} from '@/features/pdf-editor/overlayInteraction'
import type { PageSizePt } from '@/lib/pdf/clampPageRect'
import { exportableOverlayObjects } from '@/lib/redaction/maskModes'
import {
  compareOverlayLayerOrder,
  isImageOverlay,
  isMaskOverlay,
  isTextOverlay,
} from '@/types/overlayObjects'
import styles from './PageOverlayLayer.module.css'

interface PageOverlayLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  /** Omit preview-only (hidden) regions, for views that must match the export. */
  exportMatchingOnly?: boolean
}

interface MaskDraft {
  x1: number
  y1: number
  x2: number
  y2: number
}

function normalizeScreenRect(draft: MaskDraft): PageRect {
  const x = Math.min(draft.x1, draft.x2)
  const y = Math.min(draft.y1, draft.y2)
  const width = Math.abs(draft.x2 - draft.x1)
  const height = Math.abs(draft.y2 - draft.y1)
  return { x, y, width, height }
}

export function PageOverlayLayer({
  pageNumber,
  pageIndex,
  renderScale,
  exportMatchingOnly = false,
}: PageOverlayLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const {
    activeToolId,
    overlayObjects,
    selectedObjectId,
    selectObject,
    editingObjectId,
    setEditingObjectId,
    addTextObjectAtPdfPoint,
    addImageObjectAtPdfPoint,
    addMaskObjectWithBounds,
    updateTextObject,
    updateImageObject,
    updateMaskObject,
    pendingImageAssetId,
    maskEyedropperActive,
    setMaskEyedropperActive,
  } = useEditorSession()

  const [maskDraft, setMaskDraft] = useState<MaskDraft | null>(null)

  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  const pageObjects = useMemo(
    () =>
      (exportMatchingOnly ? exportableOverlayObjects(overlayObjects) : overlayObjects)
        .filter((object) => object.pageIndex === pageIndex)
        .sort(compareOverlayLayerOrder),
    [overlayObjects, pageIndex, exportMatchingOnly],
  )

  const editingText = pageObjects.find(
    (object) => object.id === editingObjectId && isTextOverlay(object),
  )

  if (!viewport || !pageTransform) {
    return null
  }

  const stageWidth = viewport.width
  const stageHeight = viewport.height
  const pageSize: PageSizePt = {
    width: pageTransform.viewport.width / pageTransform.scale,
    height: pageTransform.viewport.height / pageTransform.scale,
  }
  const manipulationEnabled = overlayManipulationEnabled(activeToolId)
  const selectionEnabled = overlaySelectionEnabled(activeToolId, pendingImageAssetId)
  const objectsListen = overlayObjectsListen(activeToolId, pendingImageAssetId)

  const cursorClass =
    activeToolId === 'pan'
      ? styles.stagePanPassThrough
      : activeToolId === 'text'
        ? styles.stageTextCursor
        : activeToolId === 'highlight'
          ? styles.stageMaskCursor
          : activeToolId === 'image' && pendingImageAssetId
            ? styles.stageImageCursor
            : activeToolId === 'select'
              ? styles.stageSelectCursor
              : styles.stageDefaultCursor

  const handlePointerDown = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    const target = event.target as Konva.Node
    if (target.name() !== 'page-background') {
      return
    }
    const stage = target.getStage()
    if (!stage) {
      return
    }

    const pointer = stage.getPointerPosition()
    if (!pointer) {
      return
    }

    if (maskEyedropperActive && event.evt instanceof MouseEvent) {
      const sampled = sampleColorFromPdfCanvas(
        pageNumber,
        event.evt.clientX,
        event.evt.clientY,
      )
      if (sampled) {
        const selected = pageObjects.find(
          (object) => object.id === selectedObjectId && isMaskOverlay(object),
        )
        if (selected && isMaskOverlay(selected)) {
          updateMaskObject(selected.id, { fillColor: sampled })
        }
      }
      setMaskEyedropperActive(false)
      return
    }

    if (activeToolId === 'highlight') {
      setMaskDraft({
        x1: pointer.x,
        y1: pointer.y,
        x2: pointer.x,
        y2: pointer.y,
      })
      return
    }

    if (activeToolId === 'select') {
      selectObject(null)
      return
    }

    if (activeToolId === 'text') {
      addTextObjectAtPdfPoint(pageIndex, screenPointToPdfPoint(pageTransform, pointer))
      return
    }

    if (activeToolId === 'image' && pendingImageAssetId) {
      addImageObjectAtPdfPoint(pageIndex, screenPointToPdfPoint(pageTransform, pointer), pendingImageAssetId)
      return
    }

  }

  const handlePointerMove = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (!maskDraft) {
      return
    }
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) {
      return
    }
    setMaskDraft((prev) =>
      prev ? { ...prev, x2: pointer.x, y2: pointer.y } : prev,
    )
  }

  const finalizeMaskDraft = (): void => {
    if (!maskDraft) {
      return
    }
    const screenRect = normalizeScreenRect(maskDraft)
    setMaskDraft(null)
    if (screenRect.width < 6 || screenRect.height < 6) {
      return
    }
    const pdfBounds = screenRectToPdfRect(pageTransform, screenRect)
    addMaskObjectWithBounds(pageIndex, pdfBounds)
  }

  const draftRect = maskDraft ? normalizeScreenRect(maskDraft) : null

  return (
    <div
      className={`${styles.host} ${cursorClass}`}
      style={{ width: stageWidth, height: stageHeight }}
      aria-label="Page overlay canvas"
    >
      <Stage
        width={stageWidth}
        height={stageHeight}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={finalizeMaskDraft}
        onTouchEnd={finalizeMaskDraft}
      >
        <Layer>
          <Rect
            name="page-background"
            width={stageWidth}
            height={stageHeight}
            fill="rgba(255,255,255,0.001)"
            listening
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
          />
          {draftRect ? (
            <Rect
              x={draftRect.x}
              y={draftRect.y}
              width={draftRect.width}
              height={draftRect.height}
              fill="rgba(255,255,255,0.75)"
              stroke="#2563eb"
              dash={[4, 4]}
              listening={false}
            />
          ) : null}
          {pageObjects.map((object) => {
            if (isMaskOverlay(object)) {
              return (
                <MaskObjectNode
                  key={object.id}
                  object={object}
                  transform={pageTransform}
                  selected={object.id === selectedObjectId && selectionEnabled}
                  manipulationEnabled={manipulationEnabled}
                  listeningEnabled={objectsListen}
                  pageSize={pageSize}
                  onSelect={() => {
                    if (selectionEnabled) {
                      selectObject(object.id)
                    }
                  }}
                  onBoundsChange={(bounds) => updateMaskObject(object.id, { bounds })}
                />
              )
            }
            if (isImageOverlay(object)) {
              return (
                <ImageObjectNode
                  key={object.id}
                  object={object}
                  transform={pageTransform}
                  selected={object.id === selectedObjectId && selectionEnabled}
                  manipulationEnabled={manipulationEnabled}
                  listeningEnabled={objectsListen}
                  pageSize={pageSize}
                  onSelect={() => {
                    if (selectionEnabled) {
                      selectObject(object.id)
                    }
                  }}
                  onChange={(patch) => updateImageObject(object.id, patch)}
                />
              )
            }
            if (isTextOverlay(object)) {
              return (
                <TextObjectNode
                  key={object.id}
                  object={object}
                  transform={pageTransform}
                  renderScale={renderScale}
                  selected={object.id === selectedObjectId && selectionEnabled}
                  manipulationEnabled={manipulationEnabled}
                  listeningEnabled={objectsListen}
                  pageSize={pageSize}
                  onSelect={() => {
                    if (selectionEnabled) {
                      selectObject(object.id)
                    }
                  }}
                  onBoundsChange={(bounds) => updateTextObject(object.id, { bounds })}
                  onEditRequest={() => {
                    selectObject(object.id)
                    setEditingObjectId(object.id)
                  }}
                />
              )
            }
            return null
          })}
        </Layer>
      </Stage>
      {editingText && isTextOverlay(editingText) ? (
        <TextInlineEditor
          object={editingText}
          transform={pageTransform}
          renderScale={renderScale}
          onCommit={(content) => {
            updateTextObject(editingText.id, { content })
            setEditingObjectId(null)
          }}
          onCancel={() => setEditingObjectId(null)}
        />
      ) : null}
    </div>
  )
}
