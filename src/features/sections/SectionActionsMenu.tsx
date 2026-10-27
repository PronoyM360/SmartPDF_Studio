import {
  DeleteOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  MoreOutlined,
  StopOutlined,
  BorderOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Modal, Tooltip, message, type MenuProps } from 'antd'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { pageRectsIntersect } from '@/lib/pdf/pageRectIntersect'
import type { OverlayObject } from '@/types/overlayObjects'
import type { SectionAction, SectionActionTarget } from './SectionActionModal'

interface SectionActionsMenuProps {
  targets: readonly SectionActionTarget[]
  onAction: (action: SectionAction) => void
  /** `compact` = icon button for a list row; `button` = labelled button for the selection bar. */
  variant: 'compact' | 'button'
  disabled?: boolean
}

function overlapsAny(object: OverlayObject, targets: readonly SectionActionTarget[]): boolean {
  return targets.some(
    (target) => target.pageIndex === object.pageIndex && pageRectsIntersect(target.bounds, object.bounds),
  )
}

function describeKinds(objects: readonly OverlayObject[]): string {
  const counts = { text: 0, image: 0, mask: 0, annotation: 0 }
  for (const object of objects) {
    counts[object.kind] += 1
  }
  return [
    counts.text ? `${counts.text} text box${counts.text === 1 ? '' : 'es'}` : null,
    counts.image ? `${counts.image} image${counts.image === 1 ? '' : 's'}` : null,
    counts.mask ? `${counts.mask} cover/hide/redact box${counts.mask === 1 ? '' : 'es'}` : null,
    counts.annotation ? `${counts.annotation} annotation${counts.annotation === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export function SectionActionsMenu({ targets, onAction, variant, disabled }: SectionActionsMenuProps) {
  const { overlayObjects, deleteOverlayObjects, undo } = useEditorSession()
  const ownEdits = overlayObjects.filter((object) => overlapsAny(object, targets))

  const removeOwnEdits = (): void => {
    Modal.confirm({
      title: `Remove your edits in ${targets.length === 1 ? 'this section' : 'these sections'}?`,
      content: `Deletes ${describeKinds(ownEdits)} that you added here. The original PDF content is not affected — it cannot be deleted in place; use Cover or Redact for that.`,
      okText: 'Remove edits',
      okType: 'danger',
      onOk: () => {
        deleteOverlayObjects(ownEdits.map((object) => object.id))
        const key = `remove-edits-${Date.now()}`
        message.open({
          key,
          type: 'success',
          duration: 6,
          content: (
            <span>
              Removed {ownEdits.length} edit{ownEdits.length === 1 ? '' : 's'}.{' '}
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
      },
    })
  }

  const items: MenuProps['items'] = [
    {
      key: 'hide',
      icon: <EyeInvisibleOutlined />,
      label: (
        <Tooltip placement="left" title="Covers it in the editor only so you can review without it. Not included in the download. Restore any time.">
          Hide in preview
        </Tooltip>
      ),
    },
    {
      key: 'cover',
      icon: <BorderOutlined />,
      label: (
        <Tooltip placement="left" title="Draws an opaque box in the downloaded PDF. The original text stays in the file underneath — not secure.">
          Cover (visual only)…
        </Tooltip>
      ),
    },
    {
      key: 'redact',
      icon: <StopOutlined />,
      danger: true,
      label: (
        <Tooltip placement="left" title="Permanently removes the content in the download by turning that page into an image with this area filled. Checked after export.">
          Redact (remove permanently)…
        </Tooltip>
      ),
    },
    { type: 'divider' },
    {
      key: 'remove-edits',
      icon: <DeleteOutlined />,
      disabled: ownEdits.length === 0,
      label: (
        <Tooltip
          placement="left"
          title={
            ownEdits.length === 0
              ? 'You have not added text, images or boxes here. Original PDF content can only be covered or redacted.'
              : 'Deletes text, images and boxes you added in this area.'
          }
        >
          Remove my edits here ({ownEdits.length})…
        </Tooltip>
      ),
    },
  ]

  const onClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'remove-edits') {
      removeOwnEdits()
      return
    }
    onAction(key as SectionAction)
  }

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']} disabled={disabled} placement="bottomRight">
      {variant === 'compact' ? (
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined />}
          aria-label="Section actions"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <Button size="small" type="primary">
          Actions <DownOutlined />
        </Button>
      )}
    </Dropdown>
  )
}
