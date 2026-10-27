import { useMemo } from 'react'
import { Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useHtmlImage } from '@/features/image-tools/useHtmlImage'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import styles from './PendingTextReplacementPreviewLayer.module.css'

interface PendingTextReplacementPreviewLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

export function PendingTextReplacementPreviewLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: PendingTextReplacementPreviewLayerProps) {
  const { pendingTextReplacement } = useEditorPreview()
  const viewport = usePageViewport(pageNumber, renderScale)
  const patch = pendingTextReplacement?.backgroundPatch ?? null
  const patchImage = useHtmlImage(patch?.url)

  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(pageIndex, viewport)
  }, [pageIndex, viewport])

  if (
    !pendingTextReplacement ||
    pendingTextReplacement.pageIndex !== pageIndex ||
    !viewport ||
    !pageTransform
  ) {
    return null
  }

  const { plan, replacementText } = pendingTextReplacement
  const maskScreen = pdfRectToScreenBounds(pageTransform, plan.maskBounds)
  const textScreen = pdfRectToScreenBounds(pageTransform, plan.textBounds)
  const patchScreen = patch ? pdfRectToScreenBounds(pageTransform, patch.bounds) : null
  const fontSizePx = plan.fontSize * renderScale

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-label="Pending text replacement preview on page"
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          {patchImage && patchScreen ? (
            <KonvaImage
              image={patchImage}
              x={patchScreen.x}
              y={patchScreen.y}
              width={patchScreen.width}
              height={patchScreen.height}
            />
          ) : null}
          <Rect
            x={maskScreen.x}
            y={maskScreen.y}
            width={maskScreen.width}
            height={maskScreen.height}
            fill={patch ? undefined : plan.maskFillColor}
            opacity={patch ? 1 : plan.maskOpacity}
            stroke="#0ea5e9"
            dash={[6, 4]}
            strokeWidth={1.5}
          />
          <Rect
            x={textScreen.x}
            y={textScreen.y}
            width={textScreen.width}
            height={textScreen.height}
            stroke="#0ea5e9"
            dash={[4, 3]}
            strokeWidth={1}
            listening={false}
          />
          <Text
            x={textScreen.x}
            y={textScreen.y}
            width={textScreen.width}
            height={textScreen.height}
            text={replacementText.trim() || '…'}
            fontFamily={plan.fontFamily}
            fontSize={fontSizePx}
            fontStyle={plan.fontWeight === 'bold' ? 'bold' : 'normal'}
            fill={plan.color}
            align={plan.alignment}
            letterSpacing={(plan.letterSpacing ?? 0) * renderScale}
            verticalAlign="top"
            wrap="word"
            listening={false}
          />
        </Layer>
      </Stage>
    </div>
  )
}
