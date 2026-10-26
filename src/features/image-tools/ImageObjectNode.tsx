import type Konva from 'konva'
import { useEffect, useRef, useState } from 'react'
import { Group, Image as KonvaImage, Transformer } from 'react-konva'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { OVERLAY_TRANSFORMER_PROPS } from '@/features/pdf-editor/overlayTransformerStyle'
import { commitGroupBounds } from '@/features/pdf-editor/overlayTransform'
import type { PageSizePt } from '@/lib/pdf/clampPageRect'
import { pdfRectToScreenRect } from '@/lib/pdf'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { ImageOverlayObject } from '@/types/imageOverlay'

interface ImageObjectNodeProps {
  object: ImageOverlayObject
  transform: PageDisplayTransform
  selected: boolean
  manipulationEnabled: boolean
  listeningEnabled: boolean
  pageSize: PageSizePt | null
  onSelect: () => void
  onChange: (patch: {
    bounds: ImageOverlayObject['bounds']
    rotation: number
  }) => void
}

export function ImageObjectNode({
  object,
  transform,
  selected,
  manipulationEnabled,
  listeningEnabled,
  pageSize,
  onSelect,
  onChange,
}: ImageObjectNodeProps) {
  const groupRef = useRef<Konva.Group>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const { getImageAsset } = useEditorSession()
  const asset = getImageAsset(object.assetId)
  const [htmlImage, setHtmlImage] = useState<HTMLImageElement | null>(null)
  const screenRect = pdfRectToScreenRect(transform, object.bounds)

  useEffect(() => {
    if (!asset) {
      setHtmlImage(null)
      return
    }
    const image = new Image()
    image.onload = () => setHtmlImage(image)
    image.src = asset.blobUrl
    return () => {
      image.onload = null
    }
  }, [asset])

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
    object.rotation,
    screenRect.width,
    screenRect.height,
  ])

  if (!htmlImage) {
    return null
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={screenRect.x}
        y={screenRect.y}
        rotation={object.rotation}
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
          onChange({
            bounds: commitGroupBounds(
              event.currentTarget as Konva.Group,
              transform,
              'image-box',
              24,
              24,
              pageSize,
            ),
            rotation: (event.currentTarget as Konva.Group).rotation(),
          })
        }}
        onTransformEnd={(event) => {
          const node = event.currentTarget as Konva.Group
          onChange({
            bounds: commitGroupBounds(node, transform, 'image-box', 24, 24, pageSize),
            rotation: node.rotation(),
          })
        }}
      >
        <KonvaImage
          name="image-box"
          image={htmlImage}
          width={screenRect.width}
          height={screenRect.height}
        />
      </Group>
      {selected && manipulationEnabled ? (
        <Transformer
          ref={transformerRef}
          {...OVERLAY_TRANSFORMER_PROPS}
          rotateEnabled
          keepRatio={object.lockAspectRatio}
          enabledAnchors={[
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 24 || newBox.height < 24) {
              return oldBox
            }
            return newBox
          }}
        />
      ) : null}
    </>
  )
}
