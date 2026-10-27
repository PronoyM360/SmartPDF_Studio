import {
  CloseOutlined,
  CommentOutlined,
  ExperimentOutlined,
  FormatPainterOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import type Konva from 'konva'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Label, Layer, Rect, Stage, Tag, Text, Transformer } from 'react-konva'
import { useRegionSelection } from '@/features/region-selection/RegionSelectionContext'
import { isGenuineRedactionSupported } from '@/lib/redaction/redactionSupport'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import {
  createPageDisplayTransform,
  pdfRectToScreenBounds,
  screenRectToPdfRect,
} from '@/lib/pdf'
import { normalizePageRotation } from '@/lib/pdf/export/rotationFrame'
import {
  clampRegionToPage,
  rectFromCorners,
  regionDimensions,
  type PageBox,
} from '@/lib/regionSelection/regionGeometry'
import type { PageRect } from '@/types'
import styles from './RegionSelectionLayer.module.css'

interface RegionSelectionLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

const MIN_DRAW_PX = 6
const ACTION_BAR_HEIGHT = 34
const DIM_FILL = 'rgba(15, 23, 42, 0.18)'
const SIZE_LABEL_CHAR_PX = 6.2

/**
 * Editor-only selection rectangle. Everything drawn here lives in this Konva stage —
 * it is never an overlay object, so it cannot reach the export.
 */
export function RegionSelectionLayer({ pageNumber, pageIndex, renderScale }: RegionSelectionLayerProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const { selection, drawSelection, adjustSelection, cancelSelection, openAction } = useRegionSelection()
  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const boxRef = useRef<Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  const transform = useMemo(
    () => (viewport ? createPageDisplayTransform(pageIndex, viewport) : null),
    [pageIndex, viewport],
  )
  // The whole canvas mapped back to user space is the page box, whatever the rotation.
  const pageBox: PageBox | null = useMemo(
    () =>
      transform && viewport
        ? screenRectToPdfRect(transform, { x: 0, y: 0, width: viewport.width, height: viewport.height })
        : null,
    [transform, viewport],
  )
  const onThisPage = selection?.pageIndex === pageIndex ? selection : null
  const screen = transform && onThisPage ? pdfRectToScreenBounds(transform, onThisPage.bounds) : null

  useEffect(() => {
    const transformer = transformerRef.current
    if (!transformer) {
      return
    }
    transformer.nodes(boxRef.current && screen ? [boxRef.current] : [])
    transformer.getLayer()?.batchDraw()
  }, [screen?.x, screen?.y, screen?.width, screen?.height, screen])

  if (!viewport || !transform || !pageBox) {
    return null
  }

  const stageWidth = viewport.width
  const stageHeight = viewport.height
  const toPdf = (rect: PageRect, mode: 'move' | 'resize'): PageRect =>
    clampRegionToPage(screenRectToPdfRect(transform, rect), pageBox, mode)

  const handlePointerDown = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const name = event.target.name()
    if (name !== 'region-bg' && name !== 'region-dim') {
      return
    }
    const pointer = event.target.getStage()?.getPointerPosition()
    if (pointer) {
      setDraft({ x1: pointer.x, y1: pointer.y, x2: pointer.x, y2: pointer.y })
    }
  }

  const handlePointerMove = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (!draft) {
      return
    }
    const pointer = event.target.getStage()?.getPointerPosition()
    if (pointer) {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              x2: Math.min(Math.max(pointer.x, 0), stageWidth),
              y2: Math.min(Math.max(pointer.y, 0), stageHeight),
            }
          : prev,
      )
    }
  }

  const finishDraft = (): void => {
    if (!draft) {
      return
    }
    const rect = rectFromCorners({ x: draft.x1, y: draft.y1 }, { x: draft.x2, y: draft.y2 })
    setDraft(null)
    if (rect.width >= MIN_DRAW_PX && rect.height >= MIN_DRAW_PX) {
      drawSelection({ pageIndex, bounds: toPdf(rect, 'resize') })
    }
  }

  const commitNode = (node: Konva.Rect, mode: 'move' | 'resize'): void => {
    const rect = {
      x: node.x(),
      y: node.y(),
      width: Math.max(MIN_DRAW_PX, node.width() * node.scaleX()),
      height: Math.max(MIN_DRAW_PX, node.height() * node.scaleY()),
    }
    node.scaleX(1)
    node.scaleY(1)
    node.width(rect.width)
    node.height(rect.height)
    adjustSelection(toPdf(rect, mode))
  }

  const draftRect = draft ? rectFromCorners({ x: draft.x1, y: draft.y1 }, { x: draft.x2, y: draft.y2 }) : null
  const dims = onThisPage
    ? regionDimensions(onThisPage.bounds, pageBox, normalizePageRotation(viewport.rotation))
    : null
  const sizeLabel = dims ? `${Math.round(dims.widthPt)} × ${Math.round(dims.heightPt)} pt · page ${pageNumber}` : ''
  const barBelow = screen ? screen.y + screen.height + ACTION_BAR_HEIGHT + 8 <= stageHeight : true
  const barTop = screen ? (barBelow ? screen.y + screen.height + 6 : Math.max(0, screen.y - ACTION_BAR_HEIGHT - 26)) : 0
  const barLeft = screen ? Math.max(0, Math.min(screen.x, stageWidth - 330)) : 0

  return (
    <div
      className={styles.host}
      style={{ width: stageWidth, height: stageHeight }}
      aria-label="Region selection — drag to draw a rectangle"
    >
      <Stage
        width={stageWidth}
        height={stageHeight}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        onMouseMove={handlePointerMove}
        onTouchMove={handlePointerMove}
        onMouseUp={finishDraft}
        onTouchEnd={finishDraft}
      >
        <Layer>
          <Rect name="region-bg" width={stageWidth} height={stageHeight} fill="rgba(255,255,255,0.001)" />
          {screen ? (
            <>
              <Rect name="region-dim" x={0} y={0} width={stageWidth} height={screen.y} fill={DIM_FILL} />
              <Rect
                name="region-dim"
                x={0}
                y={screen.y + screen.height}
                width={stageWidth}
                height={Math.max(0, stageHeight - screen.y - screen.height)}
                fill={DIM_FILL}
              />
              <Rect name="region-dim" x={0} y={screen.y} width={screen.x} height={screen.height} fill={DIM_FILL} />
              <Rect
                name="region-dim"
                x={screen.x + screen.width}
                y={screen.y}
                width={Math.max(0, stageWidth - screen.x - screen.width)}
                height={screen.height}
                fill={DIM_FILL}
              />
              <Rect
                ref={boxRef}
                name="region-box"
                x={screen.x}
                y={screen.y}
                width={screen.width}
                height={screen.height}
                fill="rgba(37, 99, 235, 0.04)"
                stroke="#2563eb"
                strokeWidth={1.5}
                dash={[6, 4]}
                draggable
                dragBoundFunc={(pos) => ({
                  x: Math.min(Math.max(pos.x, 0), stageWidth - screen.width),
                  y: Math.min(Math.max(pos.y, 0), stageHeight - screen.height),
                })}
                onDragEnd={(event) => commitNode(event.target as Konva.Rect, 'move')}
                onTransformEnd={(event) => commitNode(event.target as Konva.Rect, 'resize')}
              />
              <Transformer
                ref={transformerRef}
                {...OVERLAY_TRANSFORMER_PROPS}
                rotateEnabled={false}
                keepRatio={false}
                boundBoxFunc={(oldBox, newBox) =>
                  newBox.width < MIN_DRAW_PX ||
                  newBox.height < MIN_DRAW_PX ||
                  newBox.x < -0.5 ||
                  newBox.y < -0.5 ||
                  newBox.x + newBox.width > stageWidth + 0.5 ||
                  newBox.y + newBox.height > stageHeight + 0.5
                    ? oldBox
                    : newBox
                }
              />
              {/* Top-right, so it does not cover note badges drawn at an annotation's top-left. */}
              <Label
                x={Math.max(0, screen.x + screen.width - (sizeLabel.length * SIZE_LABEL_CHAR_PX + 8))}
                y={Math.max(0, screen.y - 22)}
                listening={false}
              >
                <Tag fill="#2563eb" cornerRadius={3} />
                <Text text={sizeLabel} fontSize={11} padding={4} fill="#ffffff" />
              </Label>
            </>
          ) : null}
          {draftRect ? (
            <Rect
              x={draftRect.x}
              y={draftRect.y}
              width={draftRect.width}
              height={draftRect.height}
              stroke="#2563eb"
              strokeWidth={1.5}
              dash={[6, 4]}
              fill="rgba(37, 99, 235, 0.08)"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
      {screen && !draft ? (
        <div className={styles.actionBar} style={{ top: barTop, left: barLeft }} role="toolbar" aria-label="Region actions">
          <Tooltip title="Read the text and background inside the region">
            <Button size="small" icon={<ExperimentOutlined />} onClick={() => openAction('analyze')}>
              Analyze
            </Button>
          </Tooltip>
          <Tooltip title="Add a PDF comment annotation; the page content is not changed">
            <Button size="small" icon={<CommentOutlined />} onClick={() => openAction('annotate')}>
              Annotate
            </Button>
          </Tooltip>
          <Tooltip title="Draw a visual cover. The content stays in the file underneath — not secure.">
            <Button size="small" icon={<FormatPainterOutlined />} onClick={() => openAction('cover')}>
              Cover
            </Button>
          </Tooltip>
          {isGenuineRedactionSupported() ? (
            <Tooltip title="Remove the content: on download the page is flattened and the result is verified">
              <Button size="small" danger icon={<StopOutlined />} onClick={() => openAction('redact')}>
                Redact
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title="Clear the selection (Esc)">
            <Button size="small" type="text" icon={<CloseOutlined />} onClick={cancelSelection} aria-label="Cancel selection" />
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}
