import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Group, Rect, Text, Transformer } from 'react-konva'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { clampPageRect, type PageSizePt } from '@/lib/pdf/clampPageRect'
import { pdfRectToScreenRect, screenRectToPdfRect } from '@/lib/pdf'
import type { PageDisplayTransform } from '@/lib/pdf'
import {
  MIN_TEXT_BOX_HEIGHT_PT,
  MIN_TEXT_BOX_WIDTH_PT,
} from '@/features/text-tools/textDefaults'
import { hexToRgbaCss } from '@/lib/pdf/export/colorUtils'
import type { TextOverlayObject } from '@/types/textOverlay'

interface TextObjectNodeProps {
  object: TextOverlayObject
  transform: PageDisplayTransform
  renderScale: number
  selected: boolean
  manipulationEnabled: boolean
  listeningEnabled: boolean
  pageSize: PageSizePt | null
  onSelect: () => void
  onBoundsChange: (bounds: TextOverlayObject['bounds']) => void
  onEditRequest: () => void
}

export function TextObjectNode({
  object,
  transform,
  renderScale,
  selected,
  manipulationEnabled,
  listeningEnabled,
  pageSize,
  onSelect,
  onBoundsChange,
  onEditRequest,
}: TextObjectNodeProps) {
  const groupRef = useRef<Konva.Group>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const screenRect = pdfRectToScreenRect(transform, object.bounds)
  const fontSizePx = object.fontSize * renderScale
  const boxFill = object.backgroundColor
    ? hexToRgbaCss(object.backgroundColor, object.backgroundOpacity ?? 1)
    : selected
      ? 'rgba(37, 99, 235, 0.04)'
      : 'transparent'

  useEffect(() => {
    if (!selected || !manipulationEnabled || !transformerRef.current || !groupRef.current) {
      transformerRef.current?.nodes([])
      return
    }
    transformerRef.current.nodes([groupRef.current])
    transformerRef.current.getLayer()?.batchDraw()
  }, [
    selected,
    manipulationEnabled,
    object.bounds,
    transform.scale,
    screenRect.width,
    screenRect.height,
  ])

  const commitNodeRect = (node: Konva.Group): void => {
    const rectNode = node.findOne('.text-box')
    const width = Math.max(
      MIN_TEXT_BOX_WIDTH_PT,
      rectNode ? rectNode.width() * node.scaleX() : screenRect.width,
    )
    const height = Math.max(
      MIN_TEXT_BOX_HEIGHT_PT,
      rectNode ? rectNode.height() * node.scaleY() : screenRect.height,
    )
    node.scaleX(1)
    node.scaleY(1)
    if (rectNode) {
      rectNode.width(width)
      rectNode.height(height)
    }

    const pdfBounds = screenRectToPdfRect(transform, {
      x: node.x(),
      y: node.y(),
      width,
      height,
    })
    onBoundsChange(pageSize ? clampPageRect(pdfBounds, pageSize) : pdfBounds)
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={screenRect.x}
        y={screenRect.y}
        draggable={manipulationEnabled}
        listening={listeningEnabled}
        onClick={(event) => {
          event.cancelBubble = true
          onSelect()
        }}
        onTap={(event) => {
          event.cancelBubble = true
          onSelect()
        }}
        onDblClick={(event) => {
          event.cancelBubble = true
          onEditRequest()
        }}
        onDblTap={(event) => {
          event.cancelBubble = true
          onEditRequest()
        }}
        onDragEnd={(event) => {
          commitNodeRect(event.currentTarget as Konva.Group)
        }}
        onTransformEnd={(event) => {
          commitNodeRect(event.currentTarget as Konva.Group)
        }}
      >
        <Rect
          name="text-box"
          width={screenRect.width}
          height={screenRect.height}
          fill={boxFill}
          stroke={selected ? '#2563eb' : 'transparent'}
          strokeWidth={1}
          dash={selected ? [4, 4] : undefined}
        />
        <Text
          text={object.content}
          width={screenRect.width}
          height={screenRect.height}
          fontFamily={object.fontFamily}
          fontSize={fontSizePx}
          fontStyle={object.fontWeight === 'bold' ? 'bold' : 'normal'}
          fill={object.color}
          align={object.alignment}
          verticalAlign="top"
          wrap="word"
          listening={false}
        />
      </Group>
      {selected && manipulationEnabled ? (
        <Transformer
          ref={transformerRef}
          {...OVERLAY_TRANSFORMER_PROPS}
          rotateEnabled={false}
          enabledAnchors={[
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
            'middle-left',
            'middle-right',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            if (
              newBox.width < MIN_TEXT_BOX_WIDTH_PT ||
              newBox.height < MIN_TEXT_BOX_HEIGHT_PT
            ) {
              return oldBox
            }
            return newBox
          }}
        />
      ) : null}
    </>
  )
}
