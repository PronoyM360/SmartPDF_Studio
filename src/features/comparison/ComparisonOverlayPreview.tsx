import type Konva from 'konva'
import { useEffect, useMemo, useRef } from 'react'
import { Layer, Stage } from 'react-konva'
import { ImageObjectNode } from '@/features/image-tools/ImageObjectNode'
import { MaskObjectNode } from '@/features/image-tools/MaskObjectNode'
import { TextObjectNode } from '@/features/text-tools/TextObjectNode'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform } from '@/lib/pdf'
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
  onStageReady?: (stage: Konva.Stage | null) => void
}

const noop = (): void => undefined

/**
 * Read-only render of committed overlays using the editor's own nodes, so comparisons
 * show exactly what the editor (and therefore the export) draws: same PDF-space
 * coordinates, rotation handling, reconstructed backgrounds and stacking order.
 */
export function ComparisonOverlayPreview({
  pageNumber,
  pageIndex,
  renderScale,
  overlayObjects,
  onStageReady,
}: ComparisonOverlayPreviewProps) {
  const viewport = usePageViewport(pageNumber, renderScale)
  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  const stageRef = useRef<Konva.Stage | null>(null)

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

  const shared = {
    transform: pageTransform,
    selected: false,
    manipulationEnabled: false,
    listeningEnabled: false,
    pageSize: null,
    onSelect: noop,
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
              return <MaskObjectNode key={object.id} object={object} {...shared} onBoundsChange={noop} />
            }
            if (isImageOverlay(object)) {
              return <ImageObjectNode key={object.id} object={object} {...shared} onChange={noop} />
            }
            if (isTextOverlay(object)) {
              return (
                <TextObjectNode
                  key={object.id}
                  object={object}
                  {...shared}
                  renderScale={renderScale}
                  onBoundsChange={noop}
                  onEditRequest={noop}
                />
              )
            }
            return null
          })}
        </Layer>
      </Stage>
    </div>
  )
}
