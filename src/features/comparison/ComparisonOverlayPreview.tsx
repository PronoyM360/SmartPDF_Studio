import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva'
import type { ImageOverlayObject } from '@/types/imageOverlay'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenRect } from '@/lib/pdf'
import { hexToRgbaCss } from '@/lib/pdf/export/colorUtils'
import type { ImageAssetRecord } from '@/features/pdf-editor/EditorSessionContext'
import {
  compareOverlayLayerOrder,
  isImageOverlay,
  isMaskOverlay,
  isTextOverlay,
  type OverlayObject,
} from '@/types/overlayObjects'
import styles from './ComparisonOverlayPreview.module.css'

interface ComparisonOverlayPreviewProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
  overlayObjects: readonly OverlayObject[]
  getImageAsset: (assetId: string) => ImageAssetRecord | undefined
  onStageReady?: (stage: import('konva').default.Stage | null) => void
}

function ComparisonImageNode({
  object,
  transform,
  getImageAsset,
}: {
  object: ImageOverlayObject
  transform: ReturnType<typeof createPageDisplayTransform>
  getImageAsset: (assetId: string) => ImageAssetRecord | undefined
}) {
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

  if (!htmlImage) {
    return null
  }

  return (
    <Group
      x={screenRect.x}
      y={screenRect.y}
      rotation={object.rotation}
      listening={false}
    >
      <KonvaImage
        image={htmlImage}
        width={screenRect.width}
        height={screenRect.height}
        listening={false}
      />
    </Group>
  )
}

export function ComparisonOverlayPreview({
  pageNumber,
  pageIndex,
  renderScale,
  overlayObjects,
  getImageAsset,
  onStageReady,
}: ComparisonOverlayPreviewProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  const stageRef = useRef<import('konva').default.Stage | null>(null)

  const pageObjects = useMemo(
    () =>
      overlayObjects
        .filter((object) => object.pageIndex === pageIndex)
        .sort(compareOverlayLayerOrder),
    [overlayObjects, pageIndex],
  )

  useEffect(() => {
    if (!viewport || !pageTransform || pageObjects.length === 0) {
      onStageReady?.(null)
      return
    }
    onStageReady?.(stageRef.current)
  }, [viewport, pageTransform, pageObjects, onStageReady])

  if (!viewport || !pageTransform || pageObjects.length === 0) {
    return null
  }

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-hidden
    >
      <Stage
        width={viewport.width}
        height={viewport.height}
        listening={false}
        ref={(node) => {
          stageRef.current = node
          if (node) {
            onStageReady?.(node)
          }
        }}
      >
        <Layer listening={false}>
          {pageObjects.map((object) => {
            if (isMaskOverlay(object)) {
              const screen = pdfRectToScreenRect(pageTransform, object.bounds)
              return (
                <Rect
                  key={object.id}
                  x={screen.x}
                  y={screen.y}
                  width={screen.width}
                  height={screen.height}
                  fill={object.fillColor}
                  opacity={object.opacity}
                  listening={false}
                />
              )
            }
            if (isImageOverlay(object)) {
              return (
                <ComparisonImageNode
                  key={object.id}
                  object={object}
                  transform={pageTransform}
                  getImageAsset={getImageAsset}
                />
              )
            }
            if (isTextOverlay(object)) {
              const screen = pdfRectToScreenRect(pageTransform, object.bounds)
              const fontSizePx = object.fontSize * renderScale
              return (
                <Group key={object.id}>
                  {object.backgroundColor ? (
                    <Rect
                      x={screen.x}
                      y={screen.y}
                      width={screen.width}
                      height={screen.height}
                      fill={hexToRgbaCss(
                        object.backgroundColor,
                        object.backgroundOpacity ?? 1,
                      )}
                      listening={false}
                    />
                  ) : null}
                  <Text
                    x={screen.x}
                    y={screen.y}
                    width={screen.width}
                    height={screen.height}
                    text={object.content}
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
              )
            }
            return null
          })}
        </Layer>
      </Stage>
    </div>
  )
}
