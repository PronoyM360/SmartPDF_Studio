import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Group, Rect, Transformer } from 'react-konva'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { commitGroupBounds } from '@/features/pdf-editor/overlayTransform'
import type { PageSizePt } from '@/lib/pdf/clampPageRect'
import { pdfRectToScreenRect } from '@/lib/pdf'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { MaskOverlayObject } from '@/types/maskOverlay'

interface MaskObjectNodeProps {
  object: MaskOverlayObject
  transform: PageDisplayTransform
  selected: boolean
  manipulationEnabled: boolean
  listeningEnabled: boolean
  pageSize: PageSizePt | null
  onSelect: () => void
  onBoundsChange: (bounds: MaskOverlayObject['bounds']) => void
}

export function MaskObjectNode({
  object,
  transform,
  selected,
  manipulationEnabled,
  listeningEnabled,
  pageSize,
  onSelect,
  onBoundsChange,
}: MaskObjectNodeProps) {
  const groupRef = useRef<Konva.Group>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const screenRect = pdfRectToScreenRect(transform, object.bounds)

  useEffect(() => {
    if (!selected || !manipulationEnabled || !transformerRef.current || !groupRef.current) {
      transformerRef.current?.nodes([])
      return
    }
    transformerRef.current.nodes([groupRef.current])
    transformerRef.current.getLayer()?.batchDraw()
  }, [selected, manipulationEnabled, object.bounds, screenRect.width, screenRect.height])

  const commit = (node: Konva.Group): void => {
    onBoundsChange(commitGroupBounds(node, transform, 'mask-box', 8, 8, pageSize))
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
        onDragEnd={(event) => {
          commit(event.currentTarget as Konva.Group)
        }}
        onTransformEnd={(event) => {
          commit(event.currentTarget as Konva.Group)
        }}
      >
        <Rect
          name="mask-box"
          width={screenRect.width}
          height={screenRect.height}
          fill={object.fillColor}
          opacity={object.opacity}
          stroke={selected ? '#64748b' : undefined}
          strokeWidth={selected ? 1 : 0}
          dash={selected ? [4, 4] : undefined}
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
            if (newBox.width < 8 || newBox.height < 8) {
              return oldBox
            }
            return newBox
          }}
        />
      ) : null}
    </>
  )
}
