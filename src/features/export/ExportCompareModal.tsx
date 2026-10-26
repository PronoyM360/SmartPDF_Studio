import { MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Space, Typography } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { ComparisonPagePane } from '@/features/comparison/ComparisonPagePane'
import { ExportedComparisonPagePane } from '@/features/export/ExportedComparisonPagePane'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
} from '@/features/pdf-editor/zoomConfig'
import styles from '@/features/comparison/DocumentComparisonModal.module.css'

const { Text } = Typography

interface ExportCompareModalProps {
  open: boolean
  onClose: () => void
  exportedBytes: Uint8Array | null
  verificationOk: boolean
  activePage: number
  pageCount: number
  onPageChange: (page: number) => void
  initialZoom?: number
}

export function ExportCompareModal({
  open,
  onClose,
  exportedBytes,
  verificationOk,
  activePage,
  pageCount,
  onPageChange,
  initialZoom = 100,
}: ExportCompareModalProps) {
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const [zoomPercent, setZoomPercent] = useState(initialZoom)
  const [fitMode, setFitMode] = useState<FitMode>('page')
  const [syncScroll, setSyncScroll] = useState(true)

  const syncScrollPair = useCallback(
    (source: HTMLDivElement, target: HTMLDivElement) => {
      if (!syncScroll || syncingRef.current) {
        return
      }
      syncingRef.current = true
      target.scrollTop = source.scrollTop
      target.scrollLeft = source.scrollLeft
      syncingRef.current = false
    },
    [syncScroll],
  )

  if (!exportedBytes) {
    return null
  }

  return (
    <Modal
      title="Compare original vs exported PDF"
      open={open}
      onCancel={onClose}
      footer={null}
      width="96vw"
      destroyOnHidden
    >
      <Alert
        type={verificationOk ? 'success' : 'warning'}
        showIcon
        message={
          verificationOk
            ? 'Structural verification passed for the last export'
            : 'Last export had verification warnings — review visually'
        }
        description="Left: original upload. Right: downloaded export file (overlays baked in). This is separate from the live editor preview."
        style={{ marginBottom: 12 }}
      />

      <div className={styles.toolbar}>
        <Space wrap>
          <Button
            size="small"
            disabled={activePage <= 1}
            onClick={() => onPageChange(activePage - 1)}
          >
            Previous
          </Button>
          <Text type="secondary">
            Page {activePage} / {pageCount}
          </Text>
          <Button
            size="small"
            disabled={activePage >= pageCount}
            onClick={() => onPageChange(activePage + 1)}
          >
            Next
          </Button>
        </Space>
        <Space wrap>
          <Button
            size="small"
            icon={<MinusOutlined />}
            onClick={() =>
              setZoomPercent((value) => Math.max(MIN_ZOOM_PERCENT, value - ZOOM_STEP_PERCENT))
            }
          />
          <Text type="secondary">{zoomPercent}%</Text>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              setZoomPercent((value) => Math.min(MAX_ZOOM_PERCENT, value + ZOOM_STEP_PERCENT))
            }
          />
          <Button
            size="small"
            type={fitMode === 'page' ? 'primary' : 'default'}
            onClick={() => setFitMode('page')}
          >
            Fit page
          </Button>
          <Button
            size="small"
            type={fitMode === 'width' ? 'primary' : 'default'}
            onClick={() => setFitMode('width')}
          >
            Fit width
          </Button>
          <Button
            size="small"
            type={syncScroll ? 'primary' : 'default'}
            onClick={() => setSyncScroll((value) => !value)}
          >
            Sync scroll
          </Button>
        </Space>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <Text strong className={styles.columnTitle}>
            Original upload
          </Text>
          <div
            ref={leftScrollRef}
            className={styles.scroll}
            onScroll={(event) => {
              if (rightScrollRef.current) {
                syncScrollPair(event.currentTarget, rightScrollRef.current)
              }
            }}
          >
            <ComparisonPagePane
              pageNumber={activePage}
              pageIndex={activePage - 1}
              zoomPercent={zoomPercent}
              fitMode={fitMode}
              variant="original"
              overlayObjects={[]}
            />
          </div>
        </div>
        <div className={styles.column}>
          <Text strong className={styles.columnTitle}>
            Exported file
          </Text>
          <div
            ref={rightScrollRef}
            className={styles.scroll}
            onScroll={(event) => {
              if (leftScrollRef.current) {
                syncScrollPair(event.currentTarget, leftScrollRef.current)
              }
            }}
          >
            <ExportedComparisonPagePane
              exportedBytes={exportedBytes}
              pageNumber={activePage}
              pageIndex={activePage - 1}
              zoomPercent={zoomPercent}
              fitMode={fitMode}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
