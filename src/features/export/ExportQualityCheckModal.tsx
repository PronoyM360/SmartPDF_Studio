import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  MinusCircleOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Collapse,
  List,
  Modal,
  Space,
  Steps,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeExportedModifications,
  requiresModifiedCopyLabel,
  summarizeModifications,
} from '@/lib/redaction/maskModes'
import {
  exportQualitySummary,
  runExportQualityChecks,
  type ExportQualityCheckItem,
  type ExportQualityReport,
} from '@/lib/pdf/export/exportQualityChecks'
import { selectExportOperations } from '@/lib/pdf/export/exportOperations'
import {
  EXPORT_STAGES,
  exportStageIndex,
  type ExportProgress,
} from '@/lib/pdf/export/exportProgress'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'
import styles from './ExportQualityCheckModal.module.css'

const { Text, Paragraph } = Typography

interface ExportQualityCheckModalProps {
  open: boolean
  onClose: () => void
  source: PdfSource | null
  overlays: readonly OverlayObject[]
  getCommittedOverlays: () => readonly OverlayObject[]
  /** Records live edits in the undo history so they become part of the export. */
  onCommitPendingEdits: () => void
  getImageBytes: (assetId: string) => Uint8Array | undefined
  expectedPageCount: number
  onDownload: (bytes: Uint8Array, report: ExportQualityReport) => void
  onCompare: (bytes: Uint8Array, report: ExportQualityReport) => void
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
  getCommittedOverlays,
  onCommitPendingEdits,
  getImageBytes,
  expectedPageCount,
  onDownload,
  onCompare,
}: ExportQualityCheckModalProps) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [report, setReport] = useState<ExportQualityReport | null>(null)
  const [markModifiedPages, setMarkModifiedPages] = useState(true)
  const runIdRef = useRef(0)
  const modifications = summarizeModifications(
    selectExportOperations({ present: overlays, committed: getCommittedOverlays() }).operations,
  )
  const hasExportedChanges = describeExportedModifications(modifications) !== null
  const amountLabelRequired = requiresModifiedCopyLabel(modifications)

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
        limitations: [],
        excluded: [],
      })
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setRunning(true)
    setRunError(null)
    setProgress({ stage: 'preparing', message: 'Starting checks…' })
    setReport(null)

    try {
      const result = await runExportQualityChecks({
        source,
        overlays,
        committedOverlays: getCommittedOverlays(),
        getImageBytes,
        expectedPageCount,
        onProgress: (next) => {
          if (runIdRef.current === runId) {
            setProgress(next)
          }
        },
        markModifiedPages,
      })
      if (runIdRef.current === runId) {
        setReport(result)
      }
    } catch (cause) {
      if (runIdRef.current === runId) {
        setRunError(
          cause instanceof Error
            ? `Export failed unexpectedly: ${cause.message}`
            : 'Export failed unexpectedly.',
        )
      }
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false)
      }
    }
  }, [source, overlays, getCommittedOverlays, getImageBytes, expectedPageCount, markModifiedPages])

  useEffect(() => {
    if (open) {
      void runChecks()
    } else {
      runIdRef.current += 1
      setReport(null)
      setRunning(false)
      setProgress(null)
      setRunError(null)
    }
  }, [open, runChecks])

  const summary = report ? exportQualitySummary(report) : null
  const failedStage = Boolean(runError) || Boolean(report && !report.exportResult)
  const stageIndex = progress ? exportStageIndex(progress.stage) : 0
  const uncommitted = report?.excluded.filter((entry) => entry.reason === 'uncommitted').length ?? 0
  const exportedBytes = report?.exportResult?.bytes ?? null

  return (
    <Modal
      title="Export quality check"
      open={open}
      onCancel={onClose}
      width={600}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={onClose}>Back to editing</Button>
          <Button onClick={() => void runChecks()} disabled={running || !source}>
            Run again
          </Button>
          <Button
            disabled={!exportedBytes || running}
            onClick={() => {
              if (report && exportedBytes) {
                onCompare(exportedBytes, report)
              }
            }}
          >
            Compare with original
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
            Download edited copy
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary" className={styles.intro}>
        The download is an edited copy of your original, built from committed edits and
        re-saved with pdf-lib. It is reopened with PDF.js and checked before download. The
        checks are automated heuristics; they cannot guarantee identical appearance in every
        PDF viewer, and the original file is never modified.
      </Paragraph>

      <Steps
        size="small"
        className={styles.steps}
        current={report && !failedStage ? EXPORT_STAGES.length - 1 : stageIndex}
        status={failedStage ? 'error' : running ? 'process' : report ? 'finish' : 'wait'}
        items={EXPORT_STAGES.map((entry) => ({ title: entry.title }))}
      />

      {hasExportedChanges ? (
        <Tooltip
          title={
            amountLabelRequired
              ? 'Required: this copy changes printed amounts or scanned text, so every changed page gets a "Modified copy" note and the document keywords record the changes.'
              : "Adds a small 'Modified copy' note in the bottom margin of each changed page. The file name and document info always record that this is an edited copy. Recommended for official documents."
          }
        >
          <Space size={6} className={styles.option}>
            <Switch
              size="small"
              checked={markModifiedPages || amountLabelRequired}
              disabled={running || amountLabelRequired}
              onChange={setMarkModifiedPages}
              aria-label="Label modified pages in the exported copy"
            />
            <Text>
              Label modified pages in the exported copy
              {amountLabelRequired ? ' (required for edited amounts and scans)' : ''}
            </Text>
          </Space>
        </Tooltip>
      ) : null}

      {amountLabelRequired ? (
        <Alert
          type="warning"
          showIcon
          message={describeExportedModifications({
            ...modifications,
            covers: 0,
            redactions: 0,
            textEdits: 0,
            images: 0,
          })}
          description="Only use this for authorized corrections or internal copies. The download is an edited copy, not an original or verified document; keep the original file for comparison."
          className={styles.banner}
        />
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
        <div className={styles.progress} role="status" aria-live="polite">
          <Text type="secondary">{progress?.message ?? 'Running checks…'}</Text>
        </div>
      ) : null}

      {runError ? (
        <Alert
          type="error"
          showIcon
          message="Export failed"
          description={`${runError} The original file was not changed. Try again, or remove the most recent edit and retry.`}
          className={styles.banner}
        />
      ) : null}

      {uncommitted > 0 && !running ? (
        <Alert
          type="warning"
          showIcon
          message={`${uncommitted} edit(s) are not committed yet and were left out`}
          description="These are live changes still being made in a properties panel. Commit them to include them in the export."
          action={
            <Button size="small" onClick={onCommitPendingEdits}>
              Commit and re-run
            </Button>
          }
          className={styles.banner}
        />
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

      {summary && report?.exportResult ? (
        <Alert
          type={summary.failed > 0 ? 'error' : summary.warning > 0 ? 'warning' : 'success'}
          showIcon
          message={
            summary.failed > 0
              ? 'Fix failed checks before downloading'
              : summary.warning > 0
                ? 'Download available with warnings'
                : 'Automated checks passed'
          }
          description={
            summary.failed > 0
              ? 'Use "Compare with original" to see what went wrong.'
              : 'Review the notes below and compare the export with the original before sharing it.'
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
                      {check.approximate ? <Tag>Heuristic</Tag> : null}
                    </Space>
                  }
                  description={
                    <>
                      <Text type="secondary" className={styles.detail}>
                        {check.detail}
                      </Text>
                      {check.subItems ? (
                        <ul className={styles.subList}>
                          {check.subItems.map((sub, index) => (
                            <li key={`${check.id}-${index}`} className={styles.subItem}>
                              {statusIcon(sub.status)}
                              <Text type="secondary" className={styles.detail}>
                                {sub.text}
                              </Text>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  }
                />
              </List.Item>
            )}
          />
          {report.limitations.length > 0 ? (
            <Collapse
              size="small"
              ghost
              className={styles.limits}
              items={[
                {
                  key: 'limits',
                  label: 'What this export cannot guarantee',
                  children: (
                    <ul className={styles.limitList}>
                      {report.limitations.map((limit) => (
                        <li key={limit}>
                          <Text type="secondary" className={styles.detail}>
                            {limit}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
          ) : null}
        </>
      ) : null}
    </Modal>
  )
}
