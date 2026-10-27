import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  MinusCircleOutlined,
} from '@ant-design/icons'
import { Alert, Button, List, Modal, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeExportedModifications,
  summarizeModifications,
} from '@/lib/redaction/maskModes'
import {
  exportQualitySummary,
  runExportQualityChecks,
  type ExportQualityCheckItem,
  type ExportQualityReport,
} from '@/lib/pdf/export/exportQualityChecks'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from './ExportQualityCheckModal.module.css'

const { Text, Paragraph } = Typography

interface ExportQualityCheckModalProps {
  open: boolean
  onClose: () => void
  source: PdfSource | null
  overlays: readonly OverlayObject[]
  getImageBytes: (assetId: string) => Uint8Array | undefined
  expectedPageCount: number
  onDownload: (bytes: Uint8Array, report: ExportQualityReport) => void
}

function statusIcon(status: ExportQualityCheckItem['status']) {
  switch (status) {
    case 'passed':
      return <CheckCircleFilled className={styles.iconPassed} aria-hidden />
    case 'warning':
      return <ExclamationCircleFilled className={styles.iconWarning} aria-hidden />
    case 'failed':
      return <CloseCircleFilled className={styles.iconFailed} aria-hidden />
    default:
      return <MinusCircleOutlined className={styles.iconSkipped} aria-hidden />
  }
}

function statusLabel(status: ExportQualityCheckItem['status']): string {
  switch (status) {
    case 'passed':
      return 'Passed'
    case 'warning':
      return 'Warning'
    case 'failed':
      return 'Failed'
    default:
      return 'Not checked'
  }
}

function statusTagColor(
  status: ExportQualityCheckItem['status'],
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'passed':
      return 'success'
    case 'warning':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'default'
  }
}

export function ExportQualityCheckModal({
  open,
  onClose,
  source,
  overlays,
  getImageBytes,
  expectedPageCount,
  onDownload,
}: ExportQualityCheckModalProps) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<ExportQualityReport | null>(null)
  const [markModifiedPages, setMarkModifiedPages] = useState(true)
  const runIdRef = useRef(0)
  const modifications = summarizeModifications(overlays)
  const hasExportedChanges = describeExportedModifications(modifications) !== null

  const runChecks = useCallback(async () => {
    if (!source) {
      setReport({
        checks: [
          {
            id: 'can_export',
            title: 'PDF can be exported',
            status: 'failed',
            detail: 'Upload a PDF before exporting.',
          },
        ],
        canDownload: false,
        exportResult: null,
        blockingMessage: 'No PDF loaded.',
      })
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setRunning(true)
    setProgress('Starting checks…')
    setReport(null)

    try {
      const result = await runExportQualityChecks({
        source,
        overlays,
        getImageBytes,
        expectedPageCount,
        onProgress: setProgress,
        markModifiedPages,
      })
      if (runIdRef.current === runId) {
        setReport(result)
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false)
        setProgress('')
      }
    }
  }, [source, overlays, getImageBytes, expectedPageCount, markModifiedPages])

  useEffect(() => {
    if (open) {
      void runChecks()
    } else {
      runIdRef.current += 1
      setReport(null)
      setRunning(false)
      setProgress('')
    }
  }, [open, runChecks])

  const summary = report ? exportQualitySummary(report) : null

  return (
    <Modal
      title="Export quality check"
      open={open}
      onCancel={onClose}
      width={520}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={onClose}>Back to editing</Button>
          <Button onClick={() => void runChecks()} disabled={running || !source}>
            Run again
          </Button>
          <Button
            type="primary"
            disabled={!report?.canDownload || running}
            onClick={() => {
              if (report?.exportResult) {
                onDownload(report.exportResult.bytes, report)
                onClose()
              }
            }}
          >
            Download PDF
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary" className={styles.intro}>
        Checks run in your browser before download. They do not guarantee identical
        appearance in every PDF viewer.
      </Paragraph>

      {hasExportedChanges ? (
        <Tooltip title="Adds a small 'Modified copy' note in the bottom margin of each changed page and records the changes in the document keywords. Recommended for official documents.">
          <Space size={6} className={styles.option}>
            <Switch
              size="small"
              checked={markModifiedPages}
              disabled={running}
              onChange={setMarkModifiedPages}
              aria-label="Label modified pages in the exported copy"
            />
            <Text>Label modified pages in the exported copy</Text>
          </Space>
        </Tooltip>
      ) : null}

      {modifications.redactions > 0 ? (
        <Alert
          type="info"
          showIcon
          message={`Redaction on page ${modifications.redactedPages.map((index) => index + 1).join(', ')}`}
          description="Those pages are flattened to images in the download so the redacted content is removed, then the file is reopened and checked. Download stays blocked unless every check passes."
          className={styles.banner}
        />
      ) : null}

      {running ? (
        <div className={styles.progress}>
          <Spin size="small" />
          <Text type="secondary">{progress || 'Running checks…'}</Text>
        </div>
      ) : null}

      {report?.blockingMessage && !report.canDownload ? (
        <Alert
          type="error"
          showIcon
          message="Export is not ready"
          description={report.blockingMessage}
          className={styles.banner}
        />
      ) : null}

      {summary && report?.canDownload ? (
        <Alert
          type={summary.failed > 0 ? 'error' : summary.warning > 0 ? 'warning' : 'success'}
          showIcon
          message={
            summary.failed > 0
              ? 'Fix failed checks before downloading'
              : summary.warning > 0
                ? 'Download available with warnings'
                : 'Checks passed — you may download'
          }
          description={
            summary.warning > 0 || summary.failed > 0
              ? 'Review warnings below. Compare the export visually after download if needed.'
              : undefined
          }
          className={styles.banner}
        />
      ) : null}

      {report ? (
        <>
          <Text type="secondary" className={styles.summaryLine}>
            {summary?.passed ?? 0} passed · {summary?.warning ?? 0} warning ·{' '}
            {summary?.failed ?? 0} failed · {summary?.notChecked ?? 0} not checked
          </Text>
          <List
            size="small"
            className={styles.list}
            dataSource={[...report.checks]}
            renderItem={(check) => (
              <List.Item className={styles.row}>
                <List.Item.Meta
                  avatar={statusIcon(check.status)}
                  title={
                    <Space size={6} wrap>
                      <Text>{check.title}</Text>
                      <Tag color={statusTagColor(check.status)}>{statusLabel(check.status)}</Tag>
                      {check.approximate ? <Tag>Approximate</Tag> : null}
                    </Space>
                  }
                  description={
                    <Text type="secondary" className={styles.detail}>
                      {check.detail}
                    </Text>
                  }
                />
              </List.Item>
            )}
          />
        </>
      ) : null}
    </Modal>
  )
}
