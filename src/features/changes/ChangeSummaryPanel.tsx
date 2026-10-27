import { RedoOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd'
import { useTrackedChanges } from '@/features/changes/useTrackedChanges'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import {
  TRACKED_CHANGE_LABELS,
  type TrackedChange,
  type TrackedChangeKind,
} from '@/lib/changes/trackedChanges'
import styles from './ChangeSummaryPanel.module.css'

const { Text } = Typography

const KIND_COLORS: Record<TrackedChangeKind, string> = {
  section: 'cyan',
  area: 'gold',
  'text-replaced': 'blue',
  'price-updated': 'purple',
  'ocr-edit': 'magenta',
  'text-added': 'geekblue',
  'image-added': 'green',
  'annotation-added': 'volcano',
}

interface ChangeSummaryPanelProps {
  /** 1-based page navigation, shared with the editor and the comparison views. */
  onNavigateToPage: (pageNumber: number) => void
}

function ChangeRow({
  change,
  focused,
  onFocus,
}: {
  change: TrackedChange
  focused: boolean
  onFocus: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className={focused ? styles.rowFocused : styles.row}
        onClick={onFocus}
        aria-pressed={focused}
      >
        <span className={styles.rowHead}>
          <Tag color={KIND_COLORS[change.kind]} className={styles.kindTag}>
            {change.title}
          </Tag>
          <Text type="secondary" className={styles.page}>
            p. {change.pageIndex + 1}
          </Text>
          {!change.inExport ? <Tag className={styles.kindTag}>Preview only</Tag> : null}
        </span>
        {change.label ? (
          <Text className={styles.detail} ellipsis>
            {change.label}
          </Text>
        ) : null}
        {change.before !== undefined ? (
          <Text className={styles.detail}>
            <span className={styles.before}>{change.before || '—'}</span>
            {' → '}
            <span className={styles.after}>{change.after || '—'}</span>
          </Text>
        ) : change.after ? (
          <Text className={styles.detail} ellipsis>
            “{change.after}”
          </Text>
        ) : null}
        {focused && change.note ? (
          <Text type="secondary" className={styles.note}>
            {change.note}
          </Text>
        ) : null}
      </button>
    </li>
  )
}

/** Edits this app made and can account for — nothing inferred from the PDF itself. */
export function ChangeSummaryPanel({ onNavigateToPage }: ChangeSummaryPanelProps) {
  const { changes, counts, focusedChange, exportIsModified, modifiedLabelRequired } = useTrackedChanges()
  const { undo, redo, canUndo, canRedo } = useEditorSession()
  const { setFocusedChangeId, previewMode, setPreviewMode } = useEditorPreview()

  const focus = (change: TrackedChange): void => {
    if (focusedChange?.id === change.id) {
      setFocusedChangeId(null)
      return
    }
    setFocusedChangeId(change.id)
    onNavigateToPage(change.pageIndex + 1)
    if (previewMode === 'edited') {
      setPreviewMode('side-by-side')
    }
  }

  return (
    <section className={styles.root} aria-label="Change summary">
      <div className={styles.header}>
        <Text strong>Changes ({counts.total})</Text>
        <Space size={2}>
          <Tooltip title="Undo (Ctrl+Z)">
            <Button size="small" type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} aria-label="Undo last edit" />
          </Tooltip>
          <Tooltip title="Redo (Ctrl+Y)">
            <Button size="small" type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} aria-label="Redo edit" />
          </Tooltip>
        </Space>
      </div>

      {counts.total === 0 ? (
        <Text type="secondary" className={styles.empty}>
          No edits yet. The edited preview shows the original PDF unchanged.
        </Text>
      ) : (
        <>
          <div className={styles.counts}>
            {(Object.keys(TRACKED_CHANGE_LABELS) as TrackedChangeKind[])
              .filter((kind) => counts.byKind[kind] > 0)
              .map((kind) => (
                <Tag key={kind} color={KIND_COLORS[kind]} className={styles.kindTag}>
                  {TRACKED_CHANGE_LABELS[kind]}: {counts.byKind[kind]}
                </Tag>
              ))}
          </div>
          <Text type="secondary" className={styles.pages}>
            Pages {counts.pages.join(', ')} · {counts.inExport} of {counts.total} in the download
          </Text>
          <ul className={styles.list}>
            {changes.map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                focused={focusedChange?.id === change.id}
                onFocus={() => focus(change)}
              />
            ))}
          </ul>
          {focusedChange ? (
            <Button size="small" type="link" className={styles.clear} onClick={() => setFocusedChangeId(null)}>
              Clear highlight
            </Button>
          ) : null}
        </>
      )}

      {exportIsModified ? (
        <Alert
          type="warning"
          showIcon
          className={styles.alert}
          message="The download is a modified copy"
          description={
            modifiedLabelRequired
              ? 'Amounts or scanned text were changed, so every changed page is labelled “Modified copy”. It is not an original or verified document.'
              : 'Label the copy as modified when you export if the document is official or will be shared.'
          }
        />
      ) : null}
      <Text type="secondary" className={styles.footnote}>
        Lists edits made in SmartPDF Studio only. It cannot detect changes made elsewhere, and
        a before/after comparison does not show that a document is authentic or unchanged.
      </Text>
    </section>
  )
}
