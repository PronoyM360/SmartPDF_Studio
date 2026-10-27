import { AimOutlined, RollbackOutlined } from '@ant-design/icons'
import { Button, Space, Tag, Tooltip, Typography, message } from 'antd'
import { useMemo } from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'
import { MASK_MODE_LABELS, maskModeOf } from '@/lib/redaction/maskModes'
import type { MaskMode, MaskOverlayObject } from '@/types/maskOverlay'
import { isMaskOverlay } from '@/types/overlayObjects'
import styles from './AppliedChangesList.module.css'

const { Text } = Typography

const MODE_TAG: Record<MaskMode, { color: string; restore: string }> = {
  hide: { color: 'cyan', restore: 'Unhide' },
  cover: { color: 'gold', restore: 'Remove cover' },
  redact: { color: 'red', restore: 'Remove redaction' },
}

/** Every hide / cover / redact box on the document, so nothing is applied silently. */
export function AppliedChangesList() {
  const { overlayObjects, deleteOverlayObjects, selectObject, undo } = useEditorSession()
  const { previewMode, setPreviewMode } = useEditorPreview()
  const { goToPage } = useDocumentSections()

  const masks = useMemo(
    () =>
      overlayObjects
        .filter(isMaskOverlay)
        .sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt),
    [overlayObjects],
  )

  if (masks.length === 0) {
    return null
  }

  const hidden = masks.filter((mask) => maskModeOf(mask) === 'hide')

  const restore = (ids: string[], text: string): void => {
    deleteOverlayObjects(ids)
    const key = `restore-${Date.now()}`
    message.open({
      key,
      type: 'success',
      duration: 5,
      content: (
        <span>
          {text}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => {
              undo()
              message.destroy(key)
            }}
          >
            Undo
          </Button>
        </span>
      ),
    })
  }

  const show = (mask: MaskOverlayObject): void => {
    if (previewMode === 'original') {
      setPreviewMode('edited')
    }
    goToPage(mask.pageIndex)
    selectObject(mask.id)
  }

  return (
    <section className={styles.root} aria-label="Applied changes">
      <div className={styles.header}>
        <Text strong className={styles.title}>
          Applied changes ({masks.length})
        </Text>
        <Space size={2}>
          {hidden.length > 0 ? (
            <Button
              size="small"
              type="link"
              onClick={() => restore(hidden.map((mask) => mask.id), `Restored ${hidden.length} hidden region(s).`)}
            >
              Restore all hidden
            </Button>
          ) : null}
          <Tooltip title="Shows the untouched original PDF. Switch back with Edited above the page.">
            <Button
              size="small"
              type="link"
              onClick={() => setPreviewMode(previewMode === 'original' ? 'edited' : 'original')}
            >
              {previewMode === 'original' ? 'Back to edited' : 'View original'}
            </Button>
          </Tooltip>
        </Space>
      </div>
      <ul className={styles.list}>
        {masks.map((mask) => {
          const mode = maskModeOf(mask)
          return (
            <li key={mask.id} className={styles.row}>
              <div className={styles.rowText}>
                <Text className={styles.label} ellipsis>
                  {mask.label ?? 'Drawn mask'}
                </Text>
                <Space size={4}>
                  <Tooltip title={MASK_MODE_LABELS[mode].long}>
                    <Tag color={MODE_TAG[mode].color}>{MASK_MODE_LABELS[mode].short}</Tag>
                  </Tooltip>
                  <Text type="secondary" className={styles.page}>
                    Page {mask.pageIndex + 1}
                  </Text>
                </Space>
              </div>
              <Tooltip title="Show on page">
                <Button type="text" size="small" icon={<AimOutlined />} aria-label="Show change on page" onClick={() => show(mask)} />
              </Tooltip>
              <Tooltip title={MODE_TAG[mode].restore}>
                <Button
                  type="text"
                  size="small"
                  icon={<RollbackOutlined />}
                  aria-label={MODE_TAG[mode].restore}
                  onClick={() => restore([mask.id], `${MODE_TAG[mode].restore}: ${mask.label ?? 'mask'}.`)}
                />
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
