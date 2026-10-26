import { Segmented, Tooltip } from 'antd'
import { useEditorPreview, type WorkspacePreviewMode } from '@/features/pdf-editor/EditorPreviewContext'
import styles from './WorkspacePreviewModeSwitch.module.css'

const OPTIONS: {
  value: WorkspacePreviewMode
  label: string
  tooltip: string
}[] = [
  {
    value: 'original',
    label: 'Original',
    tooltip: 'Uploaded PDF only — hides your overlay edits on the canvas.',
  },
  {
    value: 'edited',
    label: 'Edited',
    tooltip: 'Shows committed overlays — matches export and download.',
  },
  {
    value: 'side-by-side',
    label: 'Side by side',
    tooltip: 'Original on the left, your committed edits on the right.',
  },
]

export function WorkspacePreviewModeSwitch() {
  const { previewMode, setPreviewMode } = useEditorPreview()

  return (
    <div className={styles.root} role="group" aria-label="Document preview mode">
      <Segmented
        size="small"
        value={previewMode}
        onChange={(value) => setPreviewMode(value as WorkspacePreviewMode)}
        options={OPTIONS.map((option) => ({
          value: option.value,
          label: (
            <Tooltip title={option.tooltip}>
              <span>{option.label}</span>
            </Tooltip>
          ),
        }))}
      />
    </div>
  )
}
