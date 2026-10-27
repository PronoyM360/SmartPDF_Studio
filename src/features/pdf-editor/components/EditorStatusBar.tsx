import { Typography } from 'antd'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import type { EditorToolId } from '@/types'
import type { PropertiesTabKey } from './PropertiesSidebar'
import styles from './EditorStatusBar.module.css'

const { Text } = Typography

const TOOL_HINTS: Record<EditorToolId, string> = {
  select: 'Move/resize overlays with handles. V select · H pan · T text · I image · M mask.',
  pan: 'Drag the canvas to pan — overlays stay fixed. Press V for Select.',
  text: 'Click to add an overlay text box. Double-click or Enter to edit content.',
  image: 'Upload PNG/JPEG (I), then click to place. Aspect ratio locked by default.',
  highlight: 'Drag a rectangle to add a visual cover (not secure redaction).',
  export: 'Use Download PDF in the toolbar to export your edits.',
}

const PREVIEW_HINTS = {
  original: 'Original upload only — overlays hidden. Your edits are still saved.',
  edited: 'Committed overlays shown — matches export coordinates.',
  'side-by-side': 'Left: original upload. Right: committed edits (same as export).',
} as const

interface EditorStatusBarProps {
  activePage: number
  totalPages: number
  zoomPercent: number
  propertiesTabKey: PropertiesTabKey
}

export function EditorStatusBar({
  activePage,
  totalPages,
  zoomPercent,
  propertiesTabKey,
}: EditorStatusBarProps) {
  const { activeToolId, pendingImageAssetId } = useEditorSession()
  const { previewMode, pendingTextReplacement } = useEditorPreview()

  const hint =
    pendingTextReplacement
      ? 'Pending text replacement shown on page (cyan dashed) — Apply or Cancel in the dialog.'
      : pendingImageAssetId && activeToolId === 'image'
        ? 'Image ready — click the page to place it.'
        : propertiesTabKey === 'pdf-text'
          ? 'Find selectable PDF text; replacements use overlays (original content kept for comparison).'
          : propertiesTabKey === 'ocr'
            ? 'OCR is manual only — draw a region or run this page; overlays do not change the PDF until you apply.'
            : propertiesTabKey === 'sections'
              ? 'Section types are suggestions — click one to locate it, tick to select, or draw a region if detection misses it.'
              : `${PREVIEW_HINTS[previewMode]} ${TOOL_HINTS[activeToolId]}`

  return (
    <footer className={styles.bar} aria-label="Editor status">
      <Text type="secondary" className={styles.segment}>
        Page {activePage} of {totalPages}
      </Text>
      <span className={styles.divider} aria-hidden />
      <Text type="secondary" className={styles.segment}>
        {zoomPercent}% zoom
      </Text>
      <span className={styles.divider} aria-hidden />
      <Text type="secondary" className={styles.hint}>
        {hint}
      </Text>
      <Text type="secondary" className={styles.shortcuts}>
        Ctrl+Z undo · Ctrl+Y redo · Esc clear selection
      </Text>
    </footer>
  )
}
