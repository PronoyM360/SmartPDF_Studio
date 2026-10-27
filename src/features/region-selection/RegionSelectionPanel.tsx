import {
  CloseOutlined,
  CommentOutlined,
  ExperimentOutlined,
  FormatPainterOutlined,
  StopOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Alert, Button, Descriptions, InputNumber, Space, Tooltip, Typography } from 'antd'
import { useRegionSelection } from '@/features/region-selection/RegionSelectionContext'
import { isGenuineRedactionSupported } from '@/lib/redaction/redactionSupport'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'
import {
  clampRegionToPage,
  formatRegionSize,
  regionDimensions,
} from '@/lib/regionSelection/regionGeometry'
import type { PageRect } from '@/types'
import styles from './RegionSelectionPanel.module.css'

const { Text, Paragraph } = Typography

function round(value: number): number {
  return Math.round(value * 10) / 10
}

export function RegionSelectionPanel() {
  const {
    currentPageIndex,
    selection,
    geometry,
    canUndoSelection,
    adjustSelection,
    undoSelection,
    cancelSelection,
    openAction,
  } = useRegionSelection()
  const { goToPage } = useDocumentSections()

  if (!selection) {
    return (
      <div className={styles.root}>
        <Paragraph type="secondary" className={styles.hint}>
          Drag on the page to select a rectangle — for example when automatic section detection
          missed an area. You can then move it, resize it from the handles, and choose an action.
        </Paragraph>
        <Paragraph type="secondary" className={styles.hint}>
          The selection is only a guide in the editor: it is not saved, not part of undo history and
          never appears in the downloaded PDF. Esc clears it.
        </Paragraph>
        {canUndoSelection ? (
          <Button size="small" icon={<UndoOutlined />} onClick={undoSelection}>
            Restore previous selection
          </Button>
        ) : null}
      </div>
    )
  }

  const dims = geometry ? regionDimensions(selection.bounds, geometry.box, geometry.rotation) : null
  const setField = (key: keyof PageRect, value: number | null): void => {
    if (value === null || !geometry) {
      return
    }
    const next = { ...selection.bounds, [key]: value }
    adjustSelection(clampRegionToPage(next, geometry.box, key === 'x' || key === 'y' ? 'move' : 'resize'))
  }

  return (
    <div className={styles.root}>
      {selection.pageIndex !== currentPageIndex ? (
        <Alert
          type="info"
          showIcon
          message={`The selection is on page ${selection.pageIndex + 1}`}
          action={
            <Button size="small" onClick={() => goToPage(selection.pageIndex)}>
              Go to page
            </Button>
          }
        />
      ) : null}

      <Descriptions size="small" column={1} bordered className={styles.details}>
        <Descriptions.Item label="Page">
          {selection.pageIndex + 1}
          {geometry
            ? ` · ${Math.round(geometry.rotation === 90 || geometry.rotation === 270 ? geometry.box.height : geometry.box.width)} × ${Math.round(geometry.rotation === 90 || geometry.rotation === 270 ? geometry.box.width : geometry.box.height)} pt${geometry.rotation ? ` · rotated ${geometry.rotation}°` : ''}`
            : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Region">{dims ? formatRegionSize(dims) : '…'}</Descriptions.Item>
        <Descriptions.Item label="Share of page">
          {dims ? `${(dims.pageShare * 100).toFixed(1)}%` : '…'}
        </Descriptions.Item>
      </Descriptions>

      <Text type="secondary" className={styles.caption}>
        Position in PDF points (origin at the bottom-left of the unrotated page)
      </Text>
      <div className={styles.fields}>
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <label key={key} className={styles.field}>
            <span>{key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? 'W' : 'H'}</span>
            <InputNumber
              size="small"
              step={1}
              min={key === 'width' || key === 'height' ? 4 : undefined}
              value={round(selection.bounds[key])}
              onChange={(value) => setField(key, typeof value === 'number' ? value : null)}
              aria-label={`Selection ${key}`}
            />
          </label>
        ))}
      </div>

      <Space wrap size={6}>
        <Button size="small" icon={<ExperimentOutlined />} onClick={() => openAction('analyze')}>
          Analyze region
        </Button>
        <Button size="small" icon={<CommentOutlined />} onClick={() => openAction('annotate')}>
          Add annotation
        </Button>
        <Button size="small" icon={<FormatPainterOutlined />} onClick={() => openAction('cover')}>
          Cover region
        </Button>
        {isGenuineRedactionSupported() ? (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => openAction('redact')}>
            Redact
          </Button>
        ) : null}
      </Space>
      <Text type="secondary" className={styles.caption}>
        A cover only hides the area visually — the original content stays in the file and can be
        copied or recovered. Redact removes it on download (the page is flattened and the result
        is checked).
      </Text>

      <Space size={6}>
        <Tooltip title="Undo the last move or resize of the selection (Ctrl+Z while this tool is active)">
          <Button size="small" icon={<UndoOutlined />} disabled={!canUndoSelection} onClick={undoSelection}>
            Undo adjustment
          </Button>
        </Tooltip>
        <Button size="small" icon={<CloseOutlined />} onClick={cancelSelection}>
          Cancel
        </Button>
      </Space>
    </div>
  )
}
