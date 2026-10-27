import { ExpandOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Segmented, Space, Tag, Tooltip } from 'antd'
import { useTrackedChanges } from '@/features/changes/useTrackedChanges'
import { useEditorPreview, type WorkspacePreviewMode } from '@/features/pdf-editor/EditorPreviewContext'
import styles from './WorkspacePreviewModeSwitch.module.css'

const OPTIONS: {
  value: WorkspacePreviewMode
  label: string
  tooltip: string
}[] = [
  {
    value: 'original',
    label: 'Original PDF',
    tooltip: 'Your uploaded file as it is — no edits are shown. The original is never changed.',
  },
  {
    value: 'edited',
    label: 'Edited preview',
    tooltip: 'Committed edits on top of the original, editable. Hidden regions are preview-only.',
  },
  {
    value: 'side-by-side',
    label: 'Side by side',
    tooltip: 'Original on the left; on the right, the edits exactly as they will be downloaded. Pages, zoom and scrolling stay in sync.',
  },
]

interface WorkspacePreviewModeSwitchProps {
  /** Restores the default zoom and fit for the comparison. */
  onResetView: () => void
  onOpenComparison: () => void
}

export function WorkspacePreviewModeSwitch({ onResetView, onOpenComparison }: WorkspacePreviewModeSwitchProps) {
  const { previewMode, setPreviewMode, requestViewReset, setFocusedChangeId } = useEditorPreview()
  const { exportIsModified } = useTrackedChanges()

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
      <Space size={4} className={styles.actions}>
        {exportIsModified && previewMode !== 'original' ? (
          <Tooltip title="The download will differ from your upload. Label it as a modified copy when sharing official documents.">
            <Tag color="warning">Modified copy</Tag>
          </Tooltip>
        ) : null}
        {previewMode === 'side-by-side' ? (
          <Tooltip title="Reset zoom, fit and scrolling, and clear the highlighted change">
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => {
                onResetView()
                requestViewReset()
                setFocusedChangeId(null)
              }}
            >
              Reset view
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip title="Full-screen comparison with overlay mode and difference highlighting">
          <Button size="small" type="text" icon={<ExpandOutlined />} onClick={onOpenComparison}>
            Compare
          </Button>
        </Tooltip>
      </Space>
    </div>
  )
}
