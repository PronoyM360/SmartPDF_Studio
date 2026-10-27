import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Group, Label, Rect, Tag, Text, Transformer } from 'react-konva'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { commitGroupBounds } from '@/features/pdf-editor/overlayTransform'
import { pdfRectToScreenBounds, type PageDisplayTransform } from '@/lib/pdf'
import type { PageSizePt } from '@/lib/pdf/clampPageRect'
import { hexToRgbaCss } from '@/lib/pdf/export/colorUtils'
import type { AnnotationOverlayObject } from '@/types/annotationOverlay'

interface AnnotationObjectNodeProps {
  object: AnnotationOverlayObject
  transform: PageDisplayTransform
  selected: boolean
  manipulationEnabled: boolean
  listeningEnabled: boolean
  pageSize: PageSizePt | null
  onSelect: () => void
  onBoundsChange: (bounds: AnnotationOverlayObject['bounds']) => void
}

const NOTE_PREVIEW_CHARS = 36

/** Dashed outline plus note badge — the same look as the exported PDF annotation. */
export function AnnotationObjectNode({
  object,
  transform,
  selected,
  manipulationEnabled,
  listeningEnabled,
  pageSize,
  onSelect,
  onBoundsChange,
}: AnnotationObjectNodeProps) {
  const groupRef = useRef<Konva.Group>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const box = pdfRectToScreenBounds(transform, object.bounds)
  const note = object.note.trim()
  const preview = note.length > NOTE_PREVIEW_CHARS ? `${note.slice(0, NOTE_PREVIEW_CHARS - 1)}…` : note

  useEffect(() => {
    if (!selected || !manipulationEnabled || !transformerRef.current || !groupRef.current) {
      transformerRef.current?.nodes([])
      return
    }
    transformerRef.current.nodes([groupRef.current])
    transformerRef.current.getLayer()?.batchDraw()
  }, [selected, manipulationEnabled, box.width, box.height])

  const commit = (node: Konva.Group): void => {
    onBoundsChange(commitGroupBounds(node, transform, 'annotation-box', 8, 8, pageSize))
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={box.x}
        y={box.y}
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
        onDragEnd={(event) => commit(event.currentTarget as Konva.Group)}
        onTransformEnd={(event) => commit(event.currentTarget as Konva.Group)}
      >
        <Rect
          name="annotation-box"
          width={box.width}
          height={box.height}
          fill={hexToRgbaCss(object.color, selected ? 0.12 : 0.06)}
          stroke={object.color}
          strokeWidth={1.5}
          dash={[6, 3]}
        />
        {preview ? (
          <Label x={0} y={-18} listening={false}>
            <Tag fill={object.color} cornerRadius={3} />
            <Text text={`Note: ${preview}`} fontSize={10} padding={3} fill="#ffffff" />
          </Label>
        ) : null}
      </Group>
      {selected && manipulationEnabled ? (
        <Transformer
          ref={transformerRef}
          {...OVERLAY_TRANSFORMER_PROPS}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 8 || newBox.height < 8 ? oldBox : newBox)}
        />
      ) : null}
    </>
  )
}
