import {
  EditOutlined,
  FileSearchOutlined,
  RedoOutlined,
  RollbackOutlined,
  ScanOutlined,
  StopOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Alert, Button, Empty, Popover, Progress, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd'
import { useEffect, useMemo } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { describeAmount } from '@/lib/prices/amountFormat'
import { PRICE_ROLE_COLORS, PRICE_ROLE_LABELS } from '@/lib/prices/priceLabels'
import { MIN_SELECTABLE_TEXT_CHARS } from '@/lib/sections/analyzePageText'
import type { PriceCandidate } from '@/types/priceEditing'
import { usePriceEditor } from './PriceEditorContext'
import styles from './PricesPanel.module.css'

const { Text, Paragraph } = Typography

const CONFIDENCE_TAG = {
  high: { color: 'success', label: 'High' },
  medium: { color: 'gold', label: 'Medium' },
  low: { color: 'orange', label: 'Low' },
} as const

interface PricesPanelProps {
  activePage: number
}

export function PricesPanel({ activePage }: PricesPanelProps) {
  const pageIndex = activePage - 1
  const { pageCount, status } = usePdfViewer()
  const { canUndo, canRedo, undo, redo } = useEditorSession()
  const {
    scans,
    ocrScans,
    candidates,
    committedEdits,
    committedValues,
    committedWarnings,
    scanning,
    scanPages,
    ocrBusy,
    runOcrForPrices,
    cancelOcrForPrices,
    selectedId,
    selectCandidate,
    openEditor,
    highlightsVisible,
    setHighlightsVisible,
    setPanelActive,
    revertEdit,
  } = usePriceEditor()

  useEffect(() => {
    setPanelActive(true)
    return () => setPanelActive(false)
  }, [setPanelActive])

  const pageScan = scans[pageIndex]
  const ocrScan = ocrScans[pageIndex]

  useEffect(() => {
    if (status === 'ready' && !scans[pageIndex] && !scanning) {
      scanPages([pageIndex])
    }
  }, [status, pageIndex, scans, scanning, scanPages])

  const grouped = useMemo(() => {
    const pages = new Map<number, PriceCandidate[]>()
    for (const candidate of candidates) {
      const list = pages.get(candidate.pageIndex) ?? []
      list.push(candidate)
      pages.set(candidate.pageIndex, list)
    }
    return [...pages.entries()].sort((a, b) => a[0] - b[0])
  }, [candidates])

  const byId = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates])
  const unscannedPages = Array.from({ length: pageCount }, (_, index) => index).filter(
    (index) => scans[index]?.status !== 'done',
  )
  const imageOnly = pageScan?.status === 'done' && pageScan.textCharCount < MIN_SELECTABLE_TEXT_CHARS
  const mayHaveImagePrices = pageScan?.status === 'done' && (pageScan.hasImages || imageOnly)

  return (
    <div className={styles.root}>
      <Paragraph type="secondary" className={styles.intro}>
        Select one detected amount, preview the replacement, then apply. Edits are overlays on top of
        the original; the exported file is labelled as a <Text strong>modified copy</Text>. Use only for
        authorized corrections and internal copies.
      </Paragraph>

      <Space wrap size={6}>
        <Button
          size="small"
          type="primary"
          icon={<FileSearchOutlined />}
          loading={scanning && pageScan?.status === 'scanning'}
          onClick={() => scanPages([pageIndex])}
        >
          Scan page {activePage}
        </Button>
        <Button
          size="small"
          icon={<FileSearchOutlined />}
          disabled={scanning || unscannedPages.length === 0}
          onClick={() => scanPages(unscannedPages)}
        >
          Scan all pages
        </Button>
        {ocrBusy ? (
          <Button size="small" danger icon={<StopOutlined />} onClick={cancelOcrForPrices}>
            Cancel OCR
          </Button>
        ) : (
          <Tooltip title="Reads amounts inside images or scans on this page with OCR (local, in your browser). Results are estimates.">
            <Button size="small" icon={<ScanOutlined />} onClick={() => runOcrForPrices(pageIndex)}>
              Find in images (OCR)
            </Button>
          </Tooltip>
        )}
      </Space>

      {ocrScan?.status === 'running' ? (
        <div className={styles.progressBox}>
          <Text type="secondary" className={styles.note}>
            {ocrScan.message || 'Running OCR…'}
          </Text>
          <Progress percent={Math.round(ocrScan.progress * 100)} size="small" />
        </div>
      ) : null}
      {ocrScan?.status === 'error' && ocrScan.error ? (
        <Alert type="error" showIcon className={styles.alert} message={ocrScan.error} />
      ) : null}
      {ocrScan?.status === 'done' ? (
        <Text type="secondary" className={styles.note}>
          {ocrScan.message} {ocrScan.candidates.length} amount{ocrScan.candidates.length === 1 ? '' : 's'} found in images.
        </Text>
      ) : null}

      {pageScan?.status === 'error' ? (
        <Alert type="error" showIcon className={styles.alert} message={pageScan.error} />
      ) : null}
      {imageOnly && ocrScan?.status !== 'done' ? (
        <Alert
          type="info"
          showIcon
          className={styles.alert}
          message="This page has no selectable text"
          description="It looks scanned or image-based. Use “Find in images (OCR)” to suggest amounts; you confirm each value before editing."
        />
      ) : mayHaveImagePrices && !ocrScan ? (
        <Text type="secondary" className={styles.note}>
          This page contains images. Amounts printed inside them are only found with OCR.
        </Text>
      ) : null}

      <div className={styles.toolbar}>
        <Space size={6}>
          <Switch size="small" checked={highlightsVisible} onChange={setHighlightsVisible} aria-label="Show amount outlines" />
          <Text className={styles.note}>Show outlines</Text>
        </Space>
        <Space size={4}>
          <Tooltip title="Undo (Ctrl+Z)">
            <Button size="small" icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} aria-label="Undo" />
          </Tooltip>
          <Tooltip title="Redo (Ctrl+Y)">
            <Button size="small" icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} aria-label="Redo" />
          </Tooltip>
        </Space>
      </div>

      {pageScan?.status === 'done' && pageScan.rejected.length > 0 ? (
        <Popover
          trigger="click"
          title="Numbers not treated as prices"
          content={
            <ul className={styles.rejectedList}>
              {pageScan.rejected.slice(0, 14).map((entry, index) => (
                <li key={`${entry.text}-${index}`}>
                  <Text code>{entry.text}</Text> <Text type="secondary">{entry.reason}</Text>
                </li>
              ))}
            </ul>
          }
        >
          <Button type="link" size="small" className={styles.inlineLink}>
            {pageScan.rejected.length} number{pageScan.rejected.length === 1 ? '' : 's'} on this page ignored (dates,
            flight numbers, references…)
          </Button>
        </Popover>
      ) : null}

      {committedWarnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className={styles.alert}
          message="Related amounts may no longer match"
          description={
            <ul className={styles.warningList}>
              {committedWarnings.map((warning) => (
                <li key={warning.relationshipId}>
                  <Text className={styles.note}>{warning.message}</Text>{' '}
                  {warning.relatedCandidateIds
                    .filter((id) => !committedEdits.has(id))
                    .map((id) => byId.get(id))
                    .filter((candidate): candidate is PriceCandidate => Boolean(candidate))
                    .map((candidate) => (
                      <Button
                        key={candidate.id}
                        type="link"
                        size="small"
                        className={styles.inlineLink}
                        onClick={() => selectCandidate(candidate.id)}
                      >
                        Review {candidate.label ?? PRICE_ROLE_LABELS[candidate.role]}
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      {pageScan?.status === 'scanning' && candidates.length === 0 ? (
        <div className={styles.empty}>
          <Spin size="small" /> <Text type="secondary">Reading text…</Text>
        </div>
      ) : null}

      {candidates.length === 0 && pageScan?.status === 'done' ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No price-like amounts found. Amounts need a price label (Fare, Tax, Total…) or a currency."
        />
      ) : null}

      <div className={styles.list}>
        {grouped.map(([page, list]) => (
          <section key={page}>
            <Text type="secondary" className={styles.groupTitle}>
              Page {page + 1} · {list.length} amount{list.length === 1 ? '' : 's'}
            </Text>
            <ul className={styles.rows}>
              {list.map((candidate) => {
                const edit = committedEdits.get(candidate.id)
                const editedValue = committedValues.get(candidate.id)
                const active = candidate.id === selectedId
                return (
                  <li
                    key={candidate.id}
                    className={active ? styles.rowActive : styles.row}
                    style={{ borderLeftColor: PRICE_ROLE_COLORS[candidate.role] }}
                  >
                    <div
                      className={styles.rowBody}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectCandidate(candidate.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectCandidate(candidate.id)
                        }
                      }}
                      aria-pressed={active}
                      aria-label={`${candidate.label ?? PRICE_ROLE_LABELS[candidate.role]} ${candidate.text}, page ${candidate.pageIndex + 1}`}
                    >
                      <div className={styles.rowTitle}>
                        <Text strong className={styles.value}>
                          {edit ? (
                            <>
                              <Text delete type="secondary">
                                {candidate.text}
                              </Text>{' '}
                              {edit.content}
                            </>
                          ) : (
                            candidate.text
                          )}
                        </Text>
                        <Text type="secondary" className={styles.label}>
                          {candidate.label ?? 'No label'}
                        </Text>
                      </div>
                      <Space size={4} wrap className={styles.tags}>
                        <Tag color={PRICE_ROLE_COLORS[candidate.role]}>{PRICE_ROLE_LABELS[candidate.role]}</Tag>
                        <Tag>p. {candidate.pageIndex + 1}</Tag>
                        {candidate.source === 'ocr' ? (
                          <Tooltip title="Read from image pixels with OCR — text and position are estimates.">
                            <Tag color="purple">OCR {Math.round(candidate.ocrConfidence ?? 0)}%</Tag>
                          </Tooltip>
                        ) : null}
                        <Tooltip title={candidate.reasons.join(' · ')}>
                          <Tag color={CONFIDENCE_TAG[candidate.confidence].color}>
                            {CONFIDENCE_TAG[candidate.confidence].label}
                          </Tag>
                        </Tooltip>
                        {candidate.duplicateCount > 1 ? (
                          <Tooltip title="The same value is printed elsewhere. Only the selected one changes unless you include others when editing.">
                            <Tag color="geekblue">×{candidate.duplicateCount}</Tag>
                          </Tooltip>
                        ) : null}
                        {edit ? <Tag color="cyan">Edited</Tag> : null}
                        {!candidate.editable ? (
                          <Tooltip title={candidate.blockedReason}>
                            <Tag>Not editable</Tag>
                          </Tooltip>
                        ) : null}
                      </Space>
                      {edit && editedValue !== undefined && editedValue !== candidate.amount.value ? (
                        <Text type="secondary" className={styles.note}>
                          {describeAmount(candidate.amount, candidate.amount.value)} →{' '}
                          {describeAmount(candidate.amount, editedValue)}
                        </Text>
                      ) : null}
                    </div>
                    <div className={styles.rowActions}>
                      <Tooltip title={candidate.editable ? 'Edit this amount' : candidate.blockedReason}>
                        <Button
                          size="small"
                          type={active ? 'primary' : 'default'}
                          icon={<EditOutlined />}
                          disabled={!candidate.editable}
                          onClick={() => openEditor(candidate.id)}
                          aria-label={`Edit ${candidate.text}`}
                        />
                      </Tooltip>
                      {edit ? (
                        <Tooltip title="Remove this edit (restores the original value; Undo also works)">
                          <Button
                            size="small"
                            type="text"
                            icon={<RollbackOutlined />}
                            onClick={() => revertEdit(candidate.id)}
                            aria-label={`Revert edit of ${candidate.text}`}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
