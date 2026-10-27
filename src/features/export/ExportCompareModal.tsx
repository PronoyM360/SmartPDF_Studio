import { MinusOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Segmented, Slider, Space, Switch, Typography } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { ComparisonPagePane } from '@/features/comparison/ComparisonPagePane'
import { ExportedComparisonPagePane } from '@/features/export/ExportedComparisonPagePane'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
} from '@/features/pdf-editor/zoomConfig'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from '@/features/comparison/DocumentComparisonModal.module.css'
import exportStyles from './ExportCompareModal.module.css'

const { Text } = Typography

type CompareMode = 'side-by-side' | 'expected' | 'overlay'

interface ExportCompareModalProps {
  open: boolean
  onClose: () => void
  exportedBytes: Uint8Array | null
  verificationOk: boolean
  /** Committed edits that went into the export, drawn over the original in "expected" mode. */
  expectedOverlays: readonly OverlayObject[]
  activePage: number
  pageCount: number
  onPageChange: (page: number) => void
  initialZoom?: number
}

const MODE_DESCRIPTIONS: Record<CompareMode, string> = {
  'side-by-side': 'Left: your original upload, unchanged. Right: the exported file as PDF.js renders it.',
  expected:
    'Left: the original with your committed edits drawn by the editor (what you intended). Right: the exported file. Differences point to export problems.',
  overlay:
    'The exported file is drawn over the original. With "Difference" on, identical pixels turn black and changes stand out.',
}

export function ExportCompareModal({
  open,
  onClose,
  exportedBytes,
  verificationOk,
  expectedOverlays,
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
  const [mode, setMode] = useState<CompareMode>('side-by-side')
  const [overlayOpacity, setOverlayOpacity] = useState(50)
  const [difference, setDifference] = useState(false)

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

  const paneProps = {
    pageNumber: activePage,
    pageIndex: activePage - 1,
    zoomPercent,
    fitMode,
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
            ? 'Automated checks passed for this export — confirm visually below'
            : 'This export has failed checks or warnings — review it visually'
        }
        description={MODE_DESCRIPTIONS[mode]}
        style={{ marginBottom: 12 }}
      />

      <div className={styles.toolbar}>
        <Space wrap>
          <Segmented<CompareMode>
            size="small"
            value={mode}
            onChange={setMode}
            options={[
              { label: 'Side by side', value: 'side-by-side' },
              { label: 'Expected vs exported', value: 'expected' },
              { label: 'Overlay', value: 'overlay' },
            ]}
          />
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
            aria-label="Zoom out"
            onClick={() =>
              setZoomPercent((value) => Math.max(MIN_ZOOM_PERCENT, value - ZOOM_STEP_PERCENT))
            }
          />
          <Text type="secondary">{zoomPercent}%</Text>
          <Button
            size="small"
            icon={<PlusOutlined />}
            aria-label="Zoom in"
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
          {mode !== 'overlay' ? (
            <Button
              size="small"
              type={syncScroll ? 'primary' : 'default'}
              onClick={() => setSyncScroll((value) => !value)}
            >
              Sync scroll
            </Button>
          ) : null}
        </Space>
      </div>

      {mode === 'overlay' ? (
        <>
          <div className={styles.overlayControls}>
            <Text type="secondary">Exported opacity</Text>
            <Slider
              className={styles.opacitySlider}
              min={0}
              max={100}
              value={overlayOpacity}
              onChange={setOverlayOpacity}
              disabled={difference}
              aria-label="Exported layer opacity"
            />
            <label className={styles.switchLabel}>
              <Switch size="small" checked={difference} onChange={setDifference} />
              Difference
            </label>
          </div>
          <div className={styles.overlayColumn}>
            <div className={styles.scroll}>
              <div className={exportStyles.stack}>
                <div className={exportStyles.layer}>
                  <ComparisonPagePane {...paneProps} variant="original" overlayObjects={[]} />
                </div>
                <div
                  className={exportStyles.layer}
                  style={{
                    opacity: difference ? 1 : overlayOpacity / 100,
                    mixBlendMode: difference ? 'difference' : 'normal',
                  }}
                >
                  <ExportedComparisonPagePane exportedBytes={exportedBytes} {...paneProps} />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.columns}>
          <div className={styles.column}>
            <Text strong className={styles.columnTitle}>
              {mode === 'expected' ? 'Original + committed edits (editor preview)' : 'Original upload'}
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
                {...paneProps}
                variant={mode === 'expected' ? 'edited' : 'original'}
                overlayObjects={mode === 'expected' ? expectedOverlays : []}
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
              <ExportedComparisonPagePane exportedBytes={exportedBytes} {...paneProps} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
