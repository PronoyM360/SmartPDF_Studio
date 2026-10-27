import { AnnotationPropertiesPanel } from '@/features/annotations/AnnotationPropertiesPanel'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { ImagePropertiesPanel } from '@/features/image-tools/ImagePropertiesPanel'
import { MaskPropertiesPanel } from '@/features/image-tools/MaskPropertiesPanel'
import { RegionSelectionPanel } from '@/features/region-selection/RegionSelectionPanel'
import { TextPropertiesPanel } from '@/features/text-tools/TextPropertiesPanel'
import {
  isAnnotationOverlay,
  isImageOverlay,
  isMaskOverlay,
  isTextOverlay,
} from '@/types/overlayObjects'
import styles from './OverlayPropertiesPanel.module.css'

interface OverlayPropertiesPanelProps {
  activePage: number
  renderScale: number
}

export function OverlayPropertiesPanel({
  activePage,
  renderScale,
}: OverlayPropertiesPanelProps) {
  const { getSelectedObject, activeToolId } = useEditorSession()
  const selected = getSelectedObject()

  if (activeToolId === 'region') {
    return <RegionSelectionPanel />
  }
  if (selected && isTextOverlay(selected)) {
    return <TextPropertiesPanel object={selected} />
  }
  if (selected && isImageOverlay(selected)) {
    return <ImagePropertiesPanel object={selected} />
  }
  if (selected && isMaskOverlay(selected)) {
    return (
      <MaskPropertiesPanel
        object={selected}
        pageNumber={activePage}
        renderScale={renderScale}
      />
    )
  }
  if (selected && isAnnotationOverlay(selected)) {
    return <AnnotationPropertiesPanel object={selected} />
  }

  if (activeToolId === 'image') {
    return (
      <p className={styles.empty}>
        Upload a PNG or JPEG, then click the page to place the image.
      </p>
    )
  }
  if (activeToolId === 'highlight') {
    return (
      <p className={styles.empty}>
        Drag on the page to draw a visual mask. This covers content in the preview
        but is not secure redaction.
      </p>
    )
  }
  if (activeToolId === 'text') {
    return (
      <p className={styles.empty}>
        Click the page to add a text overlay, or select an existing text box.
      </p>
    )
  }

  if (activeToolId === 'select') {
    return (
      <p className={styles.empty}>
        Click an overlay to show resize handles. Use Pan (H) to scroll the page without
        moving objects.
      </p>
    )
  }

  return (
    <p className={styles.empty}>
      Select an overlay or choose a tool to begin editing.
    </p>
  )
}
