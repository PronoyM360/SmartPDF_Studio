import {
  AimOutlined,
  BorderOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  ScanOutlined,
  StopOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Popconfirm,
  Progress,
  Segmented,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useMemo, useState } from 'react'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { AppliedChangesList } from '@/features/sections/AppliedChangesList'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'
import {
  SectionActionModal,
  type SectionAction,
  type SectionActionTarget,
} from '@/features/sections/SectionActionModal'
import { SectionActionsMenu } from '@/features/sections/SectionActionsMenu'
import { MIN_SELECTABLE_TEXT_CHARS } from '@/lib/sections/analyzePageText'
import { getSectionCategory } from '@/lib/sections/sectionCategories'
import type { DocumentSection, PageSectionAnalysis } from '@/types/documentSections'
import styles from './SectionsPanel.module.css'

const { Text, Paragraph } = Typography

interface SectionsPanelProps {
  activePage: number
}

const NO_TARGETS: SectionActionTarget[] = []

const CONFIDENCE_TAG = {
  high: { color: 'success', label: 'High' },
  medium: { color: 'gold', label: 'Medium' },
  low: { color: 'orange', label: 'Low' },
} as const

function sourceTag(section: DocumentSection) {
  if (section.textSource === 'ocr') {
    const percent =
      section.ocrConfidence !== null ? ` ${Math.round(section.ocrConfidence)}%` : ''
    return (
      <Tooltip title="Read with OCR from page pixels — text and position are estimates.">
        <Tag color="purple">OCR{percent}</Tag>
      </Tooltip>
    )
  }
  if (section.textSource === 'pdf_text') {
    return (
      <Tooltip title="Read from selectable PDF text.">
        <Tag color="blue">PDF text</Tag>
      </Tooltip>
    )
  }
  return (
    <Tooltip title="No readable text inside this region yet.">
      <Tag>No text</Tag>
    </Tooltip>
  )
}

function uncertaintyReason(section: DocumentSection): string | null {
  const reasons: string[] = []
  if (section.alternativeCategories.length > 0) {
    reasons.push(
      `Could also be: ${section.alternativeCategories
        .map((category) => getSectionCategory(category).label)
        .join(', ')}.`,
    )
  }
  if (section.ocrConfidence !== null && section.ocrConfidence < 60) {
    reasons.push('OCR confidence is low; text may be misread.')
  }
  if (section.evidence === 'content') {
    reasons.push('No heading found; category guessed from the text content.')
  }
  if (section.ambiguous && reasons.length === 0) {
    reasons.push('Label matches more than one section type.')
  }
  return reasons.length > 0 ? reasons.join(' ') : null
}

function PageStatus({
  analysis,
  pageSectionCount,
  busy,
  onRunOcr,
}: {
  analysis: PageSectionAnalysis | undefined
  pageSectionCount: number
  busy: boolean
  onRunOcr: () => void
}) {
  if (!analysis || analysis.status === 'analyzing') {
    return null
  }
  if (analysis.status === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        message="Text extraction failed"
        description={analysis.error}
        className={styles.alert}
      />
    )
  }
  const page = analysis.pageIndex + 1
  const noText = analysis.textCharCount < MIN_SELECTABLE_TEXT_CHARS
  if (noText && analysis.ocr !== 'done') {
    return (
      <Alert
        type="warning"
        showIcon
        message={`No selectable text on page ${page}`}
        description={
          analysis.hasImages
            ? 'This page is image-based (likely scanned). Run OCR to read it in your browser, or draw a region manually.'
            : 'No text or images were found. Draw a region manually if something should be selected.'
        }
        action={
          analysis.hasImages !== false ? (
            <Button size="small" icon={<ScanOutlined />} disabled={busy} onClick={onRunOcr}>
              Run OCR
            </Button>
          ) : undefined
        }
        className={styles.alert}
      />
    )
  }
  return (
    <>
      {analysis.ocr === 'done' && pageSectionCount === 0 ? (
        <Alert
          type="info"
          showIcon
          message="OCR finished without recognizable sections"
          description={`${analysis.ocrWordCount} word${analysis.ocrWordCount === 1 ? '' : 's'} read. Try a clearer scan or draw a region manually.`}
          className={styles.alert}
        />
      ) : null}
      {analysis.ocr === 'error' ? (
        <Alert
          type="error"
          showIcon
          message="OCR failed on this page"
          action={
            <Button size="small" disabled={busy} onClick={onRunOcr}>
              Retry
            </Button>
          }
          className={styles.alert}
        />
      ) : null}
      {analysis.hasImages && !noText && analysis.ocr === 'not_run' ? (
        <Text type="secondary" className={styles.note}>
          Page {page} also contains images. Text inside images is not selectable —{' '}
          <Button type="link" size="small" className={styles.inlineLink} disabled={busy} onClick={onRunOcr}>
            run OCR
          </Button>{' '}
          to add it.
        </Text>
      ) : null}
    </>
  )
}

export function SectionsPanel({ activePage }: SectionsPanelProps) {
  const pageIndex = activePage - 1
  const { pageCount, status } = usePdfViewer()
  const { setRegionSelectActive } = useOcrSession()
  const {
    sections,
    analyses,
    job,
    error,
    clearError,
    pagesNeedingOcr,
    detectPages,
    runOcrOnPages,
    readSectionWithOcr,
    cancelJob,
    labelFor,
    renameSection,
    selectedIds,
    toggleSelected,
    setSelectedIds,
    clearSelection,
    activeSectionId,
    focusSection,
    manualSelectActive,
    setManualSelectActive,
    removeSection,
    clearAllSections,
    outlinesVisible,
    setOutlinesVisible,
  } = useDocumentSections()
  const [scope, setScope] = useState<'page' | 'all'>('page')
  const [pendingAction, setPendingAction] = useState<{
    action: SectionAction
    targets: SectionActionTarget[]
  } | null>(null)

  const busy = job !== null
  const ready = status === 'ready'
  const analysis = analyses[pageIndex]
  const analyzedPageCount = Object.values(analyses).filter((entry) => entry.status !== 'analyzing').length

  const pageSections = useMemo(
    () => sections.filter((section) => section.pageIndex === pageIndex),
    [sections, pageIndex],
  )
  const listed = scope === 'page' ? pageSections : sections

  const groups = useMemo(() => {
    const map = new Map<number, DocumentSection[]>()
    for (const section of listed) {
      const list = map.get(section.pageIndex) ?? []
      list.push(section)
      map.set(section.pageIndex, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [listed])

  const selectedSections = sections.filter((section) => selectedIds.has(section.id))
  const listedSelectedCount = listed.filter((section) => selectedIds.has(section.id)).length
  const allPageIndices = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index),
    [pageCount],
  )

  const handleCopy = async (): Promise<void> => {
    const text = selectedSections
      .map((section) => `${labelFor(section)} (page ${section.pageIndex + 1})\n${section.text}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      message.success(`Copied text from ${selectedSections.length} section${selectedSections.length === 1 ? '' : 's'}.`)
    } catch {
      message.error('Clipboard access was blocked by the browser.')
    }
  }

  const toTarget = (section: DocumentSection): SectionActionTarget => ({
    pageIndex: section.pageIndex,
    bounds: section.bounds,
    label: labelFor(section),
    sectionId: section.id,
  })

  const selectedTargets = selectedSections.map(toTarget)

  const startAction = (action: SectionAction, targets: SectionActionTarget[]): void => {
    if (targets.length === 0) {
      return
    }
    setPendingAction({ action, targets })
  }

  const renderRow = (section: DocumentSection) => {
    const category = getSectionCategory(section.category)
    const isActive = section.id === activeSectionId
    const label = labelFor(section)
    const renamed = label !== section.suggestedLabel
    const reason = section.ambiguous || section.evidence === 'content' ? uncertaintyReason(section) : null
    const confidence = CONFIDENCE_TAG[section.confidence]
    return (
      <li
        key={section.id}
        className={isActive ? styles.rowActive : styles.row}
        style={{ borderLeftColor: category.color }}
      >
        <Checkbox
          checked={selectedIds.has(section.id)}
          onChange={() => toggleSelected(section.id)}
          aria-label={`Select ${label}`}
          className={styles.rowCheck}
        />
        <div
          className={styles.rowBody}
          role="button"
          tabIndex={0}
          onClick={() => focusSection(section.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              focusSection(section.id)
            }
          }}
          aria-label={`Show ${label} on page ${section.pageIndex + 1}`}
        >
          <div
            className={styles.rowTitle}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('.ant-typography-edit, textarea')) {
                event.stopPropagation()
              }
            }}
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).closest('.ant-typography-edit, textarea')) {
                event.stopPropagation()
              }
            }}
          >
            <Text
              strong
              className={styles.rowLabel}
              editable={{
                onChange: (value) => renameSection(section.id, value),
                tooltip: 'Rename',
                maxLength: 60,
              }}
            >
              {label}
            </Text>
          </div>
          <Space size={2} wrap className={styles.tags}>
            {renamed ? (
              <Tooltip title={`Suggested: ${section.suggestedLabel}`}>
                <Tag>Renamed</Tag>
              </Tooltip>
            ) : null}
            {section.category === 'other' ? (
              <Tooltip title="Text block without a recognized section heading.">
                <Tag>Unclassified</Tag>
              </Tooltip>
            ) : (
              <Tooltip title={`Classification confidence. Suggested type: ${category.label}.`}>
                <Tag color={confidence.color}>{confidence.label}</Tag>
              </Tooltip>
            )}
            {sourceTag(section)}
            {section.origin === 'manual' ? <Tag color="geekblue">Manual</Tag> : null}
            {reason ? (
              <Tooltip title={reason}>
                <Tag color="warning" icon={<ExclamationCircleOutlined />}>
                  Uncertain
                </Tag>
              </Tooltip>
            ) : null}
          </Space>
          {section.text ? (
            <Paragraph type="secondary" className={styles.preview} ellipsis={{ rows: 2 }}>
              {section.text.replace(/\n/g, ' · ')}
            </Paragraph>
          ) : null}
        </div>
        <div className={styles.rowActions}>
          <SectionActionsMenu
            variant="compact"
            targets={[toTarget(section)]}
            onAction={(action) => {
              focusSection(section.id)
              startAction(action, [toTarget(section)])
            }}
          />
          <Tooltip title="Show on page">
            <Button
              type="text"
              size="small"
              icon={<AimOutlined />}
              onClick={() => focusSection(section.id)}
              aria-label={`Go to ${label}`}
            />
          </Tooltip>
          {section.origin === 'manual' && section.textSource !== 'pdf_text' ? (
            <Tooltip title="Read text in this region with OCR">
              <Button
                type="text"
                size="small"
                icon={<ScanOutlined />}
                disabled={busy}
                onClick={() => readSectionWithOcr(section.id)}
                aria-label="Read region with OCR"
              />
            </Tooltip>
          ) : null}
          {section.origin === 'manual' ? (
            <Popconfirm
              title="Delete this region?"
              description="The drawn region and its name are removed. The PDF is not affected."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => removeSection(section.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Delete region" />
            </Popconfirm>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <div className={styles.root}>
      <Paragraph type="secondary" className={styles.intro}>
        Suggests sections such as passenger, flight, fares and terms. Types are{' '}
        <Text strong>suggestions</Text> — check them. Nothing in the PDF changes unless you
        apply an action.
      </Paragraph>

      <Space wrap size={6} className={styles.actions}>
        <Button
          size="small"
          type="primary"
          icon={<FileSearchOutlined />}
          disabled={!ready || busy}
          onClick={() => detectPages([pageIndex])}
        >
          {analysis ? 'Re-detect page' : 'Detect on page'}
        </Button>
        {pageCount > 1 ? (
          <Button size="small" disabled={!ready || busy} onClick={() => detectPages(allPageIndices)}>
            All {pageCount} pages
          </Button>
        ) : null}
        <Tooltip title="Drag a rectangle on the page when automatic detection misses something (Esc to cancel).">
          <Button
            size="small"
            icon={<BorderOutlined />}
            type={manualSelectActive ? 'primary' : 'default'}
            disabled={!ready}
            onClick={() => {
              if (!manualSelectActive) {
                setRegionSelectActive(false)
              }
              setManualSelectActive(!manualSelectActive)
            }}
          >
            {manualSelectActive ? 'Drawing…' : 'Draw region'}
          </Button>
        </Tooltip>
      </Space>

      {manualSelectActive ? (
        <Alert
          type="info"
          showIcon
          message="Drag a rectangle on the page"
          description="The region becomes a selectable section. Text inside it is read when available. Press Esc to cancel."
          className={styles.alert}
        />
      ) : null}

      {job ? (
        <div className={styles.progressBox}>
          <Progress percent={Math.round(job.progress * 100)} size="small" />
          <div className={styles.progressRow}>
            <Text type="secondary" className={styles.progressText}>
              {job.message}
            </Text>
            <Button size="small" icon={<StopOutlined />} onClick={cancelJob}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert type="error" showIcon closable message={error} onClose={clearError} className={styles.alert} />
      ) : null}

      <PageStatus
        analysis={analysis}
        pageSectionCount={pageSections.length}
        busy={busy}
        onRunOcr={() => runOcrOnPages([pageIndex])}
      />

      {pagesNeedingOcr.length > 1 ? (
        <Alert
          type="info"
          showIcon
          message={`${pagesNeedingOcr.length} pages have no selectable text`}
          description={`Pages ${pagesNeedingOcr.map((index) => index + 1).join(', ')}. OCR runs locally, one page at a time.`}
          action={
            <Button size="small" disabled={busy} onClick={() => runOcrOnPages(pagesNeedingOcr)}>
              OCR all
            </Button>
          }
          className={styles.alert}
        />
      ) : null}

      {sections.length > 0 ? (
        <div className={styles.toolbar}>
          <Segmented
            size="small"
            value={scope}
            onChange={(value) => setScope(value as 'page' | 'all')}
            options={[
              { value: 'page', label: `Page ${activePage} (${pageSections.length})` },
              { value: 'all', label: `All (${sections.length})` },
            ]}
          />
          <Tooltip title="Show outlines for every suggestion on the page, not only selected ones">
            <Space size={4}>
              <Switch size="small" checked={outlinesVisible} onChange={setOutlinesVisible} aria-label="Show all outlines" />
              <Text type="secondary" className={styles.note}>
                Outlines
              </Text>
            </Space>
          </Tooltip>
        </div>
      ) : null}

      {listed.length > 0 ? (
        <Checkbox
          className={styles.selectAll}
          checked={listedSelectedCount === listed.length}
          indeterminate={listedSelectedCount > 0 && listedSelectedCount < listed.length}
          onChange={(event) => {
            const ids = listed.map((section) => section.id)
            if (event.target.checked) {
              setSelectedIds([...selectedIds, ...ids])
            } else {
              setSelectedIds([...selectedIds].filter((id) => !ids.includes(id)))
            }
          }}
        >
          <Text className={styles.note}>Select all listed</Text>
        </Checkbox>
      ) : null}

      {listed.length === 0 ? (
        <div className={styles.empty}>
          {!ready ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Open a PDF to detect sections." />
          ) : analysis?.status === 'analyzing' ? null : analysis?.status === 'done' &&
            analysis.textCharCount >= MIN_SELECTABLE_TEXT_CHARS ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Text was found on this page, but no recognizable sections. Use Draw region to select one manually."
            />
          ) : !analysis ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                analyzedPageCount > 0
                  ? 'This page has not been analyzed yet. Detect on page to see suggestions.'
                  : 'Detect sections to see suggestions for this document.'
              }
            />
          ) : null}
        </div>
      ) : (
        <div className={styles.list}>
          {groups.map(([groupPageIndex, list]) => (
            <section key={groupPageIndex} aria-label={`Page ${groupPageIndex + 1} sections`}>
              {scope === 'all' ? (
                <Text type="secondary" className={styles.groupTitle}>
                  Page {groupPageIndex + 1} · {list.length}
                </Text>
              ) : null}
              <ul className={styles.rows}>{list.map(renderRow)}</ul>
            </section>
          ))}
        </div>
      )}

      {selectedSections.length > 0 ? (
        <div className={styles.selectionBar}>
          <Text strong className={styles.note}>
            {selectedSections.length} selected
          </Text>
          <Space size={4} wrap>
            <Tooltip title="Copy the text of selected sections">
              <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopy()}>
                Copy
              </Button>
            </Tooltip>
            <SectionActionsMenu
              variant="button"
              targets={selectedTargets}
              onAction={(action) => startAction(action, selectedTargets)}
            />
            <Button size="small" type="text" onClick={clearSelection}>
              Deselect
            </Button>
          </Space>
        </div>
      ) : null}

      <AppliedChangesList />

      <SectionActionModal
        action={pendingAction?.action ?? null}
        targets={pendingAction?.targets ?? NO_TARGETS}
        onClose={() => setPendingAction(null)}
      />

      {sections.length > 0 ? (
        <Popconfirm
          title="Clear all sections?"
          description="Removes detected and drawn sections, names and selections. The PDF is not affected."
          okText="Clear"
          okButtonProps={{ danger: true }}
          onConfirm={clearAllSections}
        >
          <Button size="small" type="link" danger className={styles.clearAll}>
            Clear all sections
          </Button>
        </Popconfirm>
      ) : null}
    </div>
  )
}
