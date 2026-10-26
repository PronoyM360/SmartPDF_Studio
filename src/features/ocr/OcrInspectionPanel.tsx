import { ScanOutlined, StopOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Empty,
  Input,
  List,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import { useMemo, useState } from 'react'
import { OCR_LANGUAGE_PACKS } from '@/lib/ocr/languages'
import { ocrConfidenceLabel, ocrConfidenceTier } from '@/lib/ocr/ocrConfidence'
import { OcrEditWorkflowModal } from '@/features/ocr/OcrEditWorkflowModal'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import type { OcrTextItem } from '@/types/ocr'
import styles from './OcrInspectionPanel.module.css'

const { Text, Paragraph } = Typography

export function OcrInspectionPanel() {
  const {
    languageId,
    setLanguageId,
    job,
    pageResult,
    correctedTextById,
    setCorrectedText,
    selectedItemId,
    selectItem,
    adjustmentBounds,
    regionSelectActive,
    setRegionSelectActive,
    runOcrOnCurrentPage,
    cancelOcr,
    clearPageOcr,
    priceMatchCount,
    getSelectedItem,
  } = useOcrSession()

  const [filter, setFilter] = useState<'all' | 'prices'>('all')
  const [editModalOpen, setEditModalOpen] = useState(false)

  const busy =
    job.status === 'rendering' ||
    job.status === 'loading-worker' ||
    job.status === 'recognizing'

  const visibleItems = useMemo(() => {
    const items = pageResult?.items ?? []
    if (filter === 'prices') {
      return items.filter((item) => item.tags.includes('price'))
    }
    return items
  }, [pageResult, filter])

  const lowConfidenceCount = useMemo(
    () =>
      (pageResult?.items ?? []).filter((item) => ocrConfidenceTier(item.confidence) === 'low')
        .length,
    [pageResult],
  )

  const selectedItem = getSelectedItem()

  const languageOptions = OCR_LANGUAGE_PACKS.map((pack) => ({
    value: pack.id,
    label: pack.available ? pack.label : `${pack.label} (not bundled)`,
    disabled: !pack.available,
  }))

  const banglaNote = OCR_LANGUAGE_PACKS.find((pack) => pack.id === 'ben')

  const progressStatus =
    job.status === 'error'
      ? 'exception'
      : job.status === 'cancelled'
        ? 'normal'
        : undefined

  return (
    <div className={styles.root}>
      <Paragraph type="secondary" className={styles.intro}>
        OCR runs only when you start it (never on every page automatically). Tesseract.js
        loads in a Web Worker with no backend. Results are{' '}
        <Text strong>position and text estimates</Text> — correct them before applying an
        overlay. The original PDF is not modified until you commit a correction.
      </Paragraph>

      <Alert
        type="info"
        showIcon
        message="Image / scan text"
        description="Text baked into images cannot be edited like selectable PDF text. OCR finds approximate boxes; masks and overlays visually cover the old pixels."
        className={styles.alert}
      />

      <Text className={styles.label}>Language</Text>
      <Select
        size="small"
        className={styles.language}
        value={languageId}
        options={languageOptions}
        onChange={setLanguageId}
        disabled={busy}
        aria-label="OCR language"
      />
      {banglaNote && !banglaNote.available ? (
        <Text type="secondary" className={styles.note}>
          {banglaNote.availabilityNote}
        </Text>
      ) : null}

      <Space wrap className={styles.actions}>
        <Button
          size="small"
          type="primary"
          icon={<ScanOutlined />}
          disabled={busy}
          onClick={runOcrOnCurrentPage}
        >
          OCR this page
        </Button>
        <Button
          size="small"
          disabled={busy}
          type={regionSelectActive ? 'primary' : 'default'}
          onClick={() => setRegionSelectActive(!regionSelectActive)}
        >
          {regionSelectActive ? 'Draw region…' : 'OCR region'}
        </Button>
        {busy ? (
          <Button size="small" icon={<StopOutlined />} onClick={cancelOcr}>
            Cancel
          </Button>
        ) : null}
        {pageResult ? (
          <Button size="small" disabled={busy} onClick={clearPageOcr}>
            Clear results
          </Button>
        ) : null}
      </Space>

      {busy ||
      job.status === 'done' ||
      job.status === 'error' ||
      job.status === 'cancelled' ? (
        <div className={styles.progressBox}>
          <Progress
            percent={Math.round(job.progress * 100)}
            size="small"
            status={progressStatus}
          />
          <Text type="secondary" className={styles.progressText}>
            {job.message || job.status}
          </Text>
        </div>
      ) : null}

      {job.error ? (
        <Alert type="error" showIcon message={job.error} className={styles.alert} />
      ) : null}

      {job.status === 'cancelled' && !busy ? (
        <Alert
          type="info"
          showIcon
          message="OCR cancelled"
          description="Worker resources were released. You can run OCR again when ready."
          className={styles.alert}
        />
      ) : null}

      {regionSelectActive ? (
        <Alert
          type="info"
          showIcon
          message="Drag a rectangle on the page"
          description="Only the selected region is sent to OCR. Existing results outside the region are kept."
          className={styles.alert}
        />
      ) : null}

      {pageResult?.regionBounds ? (
        <Text type="secondary" className={styles.note}>
          Last run: region OCR (approximate bounds). Merge with prior results on this page.
        </Text>
      ) : null}

      {lowConfidenceCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`${lowConfidenceCount} low-confidence estimate${lowConfidenceCount === 1 ? '' : 's'}`}
          description="Common on blurry scans or small prices. Correct text and adjust the cover box before applying."
          className={styles.alert}
        />
      ) : null}

      {priceMatchCount > 1 ? (
        <Alert
          type="warning"
          showIcon
          message={`${priceMatchCount} price-like values on this page`}
          description="Select one match at a time and confirm before applying an edit."
          className={styles.alert}
        />
      ) : null}

      <Space className={styles.filters}>
        <Button
          size="small"
          type={filter === 'all' ? 'primary' : 'default'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          size="small"
          type={filter === 'prices' ? 'primary' : 'default'}
          onClick={() => setFilter('prices')}
        >
          Prices / numbers
        </Button>
      </Space>

      <List
        size="small"
        className={styles.list}
        dataSource={[...visibleItems]}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No OCR results yet. Run OCR on this page or drag a region over image text."
            />
          ),
        }}
        renderItem={(item: OcrTextItem) => {
          const tier = ocrConfidenceTier(item.confidence)
          return (
            <List.Item
              className={
                item.id === selectedItemId ? styles.itemActive : styles.item
              }
              actions={[
                <Button
                  key="select"
                  type="link"
                  size="small"
                  onClick={() => selectItem(item.id)}
                >
                  Show
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={4} wrap>
                    <Tag color="default">OCR estimate</Tag>
                    <Tag
                      color={
                        tier === 'high' ? 'success' : tier === 'medium' ? 'processing' : 'warning'
                      }
                    >
                      {ocrConfidenceLabel(item.confidence)}
                    </Tag>
                    {item.tags.includes('price') ? <Tag color="purple">Price</Tag> : null}
                    {item.tags.includes('quantity') ? <Tag>Qty</Tag> : null}
                    <Text ellipsis style={{ maxWidth: 120 }}>
                      {item.text}
                    </Text>
                  </Space>
                }
                description={
                  <Input
                    size="small"
                    placeholder="Correct OCR text…"
                    value={correctedTextById[item.id] ?? item.text}
                    onChange={(event) =>
                      setCorrectedText(item.id, event.target.value)
                    }
                    aria-label={`Correct OCR estimate for ${item.text}`}
                  />
                }
              />
            </List.Item>
          )
        }}
      />

      {selectedItem ? (
        <div className={styles.selection}>
          <Text strong>Selected estimate</Text>
          <Paragraph className={styles.recognized}>
            Recognized: {selectedItem.text} ({ocrConfidenceLabel(selectedItem.confidence)})
          </Paragraph>
          <Paragraph type="secondary" className={styles.recognized}>
            Approx. position on page {selectedItem.pageIndex + 1} — adjust in the preview
            dialog if the box is off.
          </Paragraph>
          <Button
            size="small"
            type="primary"
            onClick={() => setEditModalOpen(true)}
          >
            Preview correction…
          </Button>
        </div>
      ) : null}

      <OcrEditWorkflowModal
        open={editModalOpen}
        item={selectedItem}
        recognizedText={selectedItem?.text ?? ''}
        correctedText={
          selectedItem
            ? (correctedTextById[selectedItem.id] ?? selectedItem.text)
            : ''
        }
        initialBounds={adjustmentBounds}
        priceMatchCount={priceMatchCount}
        onClose={() => setEditModalOpen(false)}
      />
    </div>
  )
}
