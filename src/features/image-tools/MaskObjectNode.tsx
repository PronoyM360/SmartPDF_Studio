import type Konva from 'konva'
import { useEffect, useRef } from 'react'
import { Group, Image as KonvaImage, Rect, Text, Transformer } from 'react-konva'
import { maskModeOf } from '@/lib/redaction/maskModes'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { useHtmlImage } from '@/features/image-tools/useHtmlImage'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { commitGroupBounds } from '@/features/pdf-editor/overlayTransform'
import type { PageSizePt } from '@/lib/pdf/clampPageRect'
import { pdfRectToScreenBounds } from '@/lib/pdf'
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
  const screenRect = pdfRectToScreenBounds(transform, object.bounds)
  const mode = maskModeOf(object)
  const { getImageAsset } = useEditorSession()
  const patchAsset =
    object.backgroundPatch && mode === 'cover' ? getImageAsset(object.backgroundPatch.assetId) : undefined
  const patchImage = useHtmlImage(patchAsset?.blobUrl)
  const labelBox = {
    x: Math.min(0, screenRect.width),
    y: Math.min(0, screenRect.height),
    width: Math.abs(screenRect.width),
    height: Math.abs(screenRect.height),
  }

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
        {patchImage ? (
          <KonvaImage
            image={patchImage}
            width={screenRect.width}
            height={screenRect.height}
            listening={false}
          />
        ) : null}
        <Rect
          name="mask-box"
          width={screenRect.width}
          height={screenRect.height}
          fill={patchAsset ? 'rgba(0,0,0,0.001)' : object.fillColor}
          opacity={mode === 'cover' && !patchAsset ? object.opacity : 1}
          stroke={selected ? '#64748b' : mode === 'hide' ? '#0d9488' : undefined}
          strokeWidth={selected || mode === 'hide' ? 1 : 0}
          dash={selected || mode === 'hide' ? [4, 4] : undefined}
        />
        {mode !== 'cover' && labelBox.width >= 36 && labelBox.height >= 10 ? (
          <Text
            x={labelBox.x}
            y={labelBox.y}
            width={labelBox.width}
            height={labelBox.height}
            text={mode === 'redact' ? 'REDACT' : 'HIDDEN'}
            fontSize={Math.min(10, labelBox.height * 0.6)}
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
            fill={mode === 'redact' ? '#f8fafc' : '#0f766e'}
            opacity={mode === 'redact' ? 0.85 : 0.7}
            listening={false}
          />
        ) : null}
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
