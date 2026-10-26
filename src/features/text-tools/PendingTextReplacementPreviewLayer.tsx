import { useMemo } from 'react'
import { Layer, Rect, Stage, Text } from 'react-konva'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform, pdfRectToScreenRect } from '@/lib/pdf'
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
  const maskScreen = pdfRectToScreenRect(pageTransform, plan.maskBounds)
  const textScreen = pdfRectToScreenRect(pageTransform, plan.textBounds)
  const fontSizePx = plan.fontSize * renderScale

  return (
    <div
      className={styles.host}
      style={{ width: viewport.width, height: viewport.height }}
      aria-label="Pending text replacement preview on page"
    >
      <Stage width={viewport.width} height={viewport.height} listening={false}>
        <Layer listening={false}>
          <Rect
            x={maskScreen.x}
            y={maskScreen.y}
            width={maskScreen.width}
            height={maskScreen.height}
            fill={plan.maskFillColor}
            opacity={plan.maskOpacity}
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
            verticalAlign="top"
            wrap="word"
            listening={false}
          />
        </Layer>
      </Stage>
    </div>
  )
}
