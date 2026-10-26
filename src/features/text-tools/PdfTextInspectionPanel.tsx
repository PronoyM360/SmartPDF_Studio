import {
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Empty,
  Input,
  List,
  Modal,
  Radio,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useMemo, useState } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { assessReplaceAllReliability } from '@/features/text-tools/assessReplaceAllReliability'
import { buildOverlayCorrectionForSearchMatch } from '@/features/text-tools/buildSearchMatchCorrection'
import { usePdfTextInspect } from '@/features/text-tools/PdfTextInspectContext'
import { TextReplacementWorkflowModal } from '@/features/text-tools/TextReplacementWorkflowModal'
import type { PdfTextSearchResult } from '@/types/pdfTextInspection'
import styles from './PdfTextInspectionPanel.module.css'

const { Text, Paragraph } = Typography

function formatMatchPosition(result: PdfTextSearchResult): string {
  const context = result.context
  const fullItem =
    result.matchStartIndex === 0 && result.matchText.trim() === context
  if (fullItem) {
    return 'Full text item'
  }
  const snippet = context.length > 40 ? `${context.slice(0, 40)}…` : context
  return `Partial match in “${snippet}”`
}

export function PdfTextInspectionPanel() {
  const {
    loading,
    error,
    pageItems,
    allItems,
    searchQuery,
    setSearchQuery,
    searchScope,
    setSearchScope,
    searchResults,
    activeResultIndex,
    activeSearchResult,
    focusSearchResult,
    goToNextResult,
    goToPreviousResult,
    selectedItem,
    selectItemById,
    adjustmentBounds,
  } = usePdfTextInspect()

  const { applyOverlayTextCorrections } = useEditorSession()

  const [replaceText, setReplaceText] = useState('')
  const [replaceModalOpen, setReplaceModalOpen] = useState(false)
  const [modalSearchMatch, setModalSearchMatch] = useState<PdfTextSearchResult | null>(
    null,
  )
  const [modalReplacementSeed, setModalReplacementSeed] = useState<string | undefined>()

  const replaceAllAssessment = useMemo(
    () => assessReplaceAllReliability(searchResults, replaceText),
    [searchResults, replaceText],
  )

  const activeMatchLabel =
    searchResults.length > 0
      ? `${activeResultIndex + 1} of ${searchResults.length}`
      : null

  const openReplaceForMatch = (match: PdfTextSearchResult | null, seed?: string): void => {
    if (!match || !selectedItem) {
      return
    }
    setModalSearchMatch(match)
    setModalReplacementSeed(seed ?? (replaceText.trim() || undefined))
    setReplaceModalOpen(true)
  }

  const openReplaceForWholeItem = (): void => {
    if (!selectedItem) {
      return
    }
    setModalSearchMatch(null)
    setModalReplacementSeed(replaceText.trim() || undefined)
    setReplaceModalOpen(true)
  }

  const handleReplaceAll = (): void => {
    if (!replaceAllAssessment.reliable) {
      return
    }
    Modal.confirm({
      title: `Replace all ${searchResults.length} matches?`,
      content: (
        <>
          <Paragraph style={{ marginBottom: 8 }}>
            Each match will become a mask + text overlay on top of the original PDF.
            Original content stays in the file for comparison (side-by-side preview).
          </Paragraph>
          <Text>
            Find “{searchQuery.trim()}” → Replace with “{replaceText.trim()}”
          </Text>
        </>
      ),
      okText: 'Replace all',
      cancelText: 'Cancel',
      onOk: () => {
        const inputs = searchResults.flatMap((result) => {
          const item = allItems.find((entry) => entry.id === result.itemId)
          if (!item) {
            return []
          }
          return [
            buildOverlayCorrectionForSearchMatch({
              item,
              result,
              replacementMatchText: replaceText.trim(),
              colorSample: null,
            }),
          ]
        })
        applyOverlayTextCorrections(inputs)
      },
    })
  }

  return (
    <div className={styles.root}>
      <Paragraph type="secondary" className={styles.intro}>
        Find and replace <Text strong>selectable PDF text</Text> extracted with PDF.js.
        Text inside images or scans is not editable here — use the{' '}
        <Text strong>OCR</Text> tab and overlay correction instead.
      </Paragraph>

      <Text strong className={styles.sectionLabel}>
        Find
      </Text>
      <Input
        allowClear
        size="small"
        prefix={<SearchOutlined aria-hidden />}
        placeholder="Search phrase, price, or label…"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        aria-label="Find in PDF text"
      />

      <Radio.Group
        size="small"
        value={searchScope}
        onChange={(event) => setSearchScope(event.target.value)}
        className={styles.scope}
      >
        <Radio.Button value="page">This page</Radio.Button>
        <Radio.Button value="document">Document</Radio.Button>
      </Radio.Group>

      <Text strong className={styles.sectionLabel}>
        Replace
      </Text>
      <Input
        allowClear
        size="small"
        prefix={<SwapOutlined aria-hidden />}
        placeholder="Replacement text…"
        value={replaceText}
        onChange={(event) => setReplaceText(event.target.value)}
        aria-label="Replace with"
        disabled={!searchQuery.trim()}
      />

      <Space wrap className={styles.replaceActions}>
        <Tooltip
          title={
            activeSearchResult
              ? 'Review overlay correction for the active match'
              : 'Run a search and select a match first'
          }
        >
          <Button
            size="small"
            type="primary"
            disabled={!activeSearchResult || !selectedItem}
            onClick={() => openReplaceForMatch(activeSearchResult)}
          >
            Replace match…
          </Button>
        </Tooltip>
        <Tooltip
          title={
            replaceAllAssessment.reliable
              ? 'Apply overlay correction to every match in one step (one Undo reverts all)'
              : replaceAllAssessment.reasons[0]
          }
        >
          <Button
            size="small"
            disabled={!replaceAllAssessment.reliable}
            onClick={handleReplaceAll}
          >
            Replace all
          </Button>
        </Tooltip>
      </Space>

      {!replaceAllAssessment.reliable && searchResults.length > 0 && replaceText.trim() ? (
        <Text type="secondary" className={styles.replaceAllHint}>
          {replaceAllAssessment.reasons[0]}
        </Text>
      ) : null}

      {loading ? (
        <div className={styles.loading}>
          <Spin size="small" tip="Extracting text…" />
        </div>
      ) : null}

      {error ? (
        <Text type="danger" className={styles.error}>
          {error}
        </Text>
      ) : null}

      {searchQuery.trim() ? (
        <div className={styles.resultsHeader}>
          <Text type="secondary" className={styles.meta}>
            {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
            {activeMatchLabel ? ` · ${activeMatchLabel}` : ''}
          </Text>
          <Space size={4}>
            <Button
              size="small"
              icon={<LeftOutlined />}
              onClick={goToPreviousResult}
              disabled={searchResults.length === 0}
              aria-label="Previous match"
            />
            <Button
              size="small"
              icon={<RightOutlined />}
              onClick={goToNextResult}
              disabled={searchResults.length === 0}
              aria-label="Next match"
            />
          </Space>
        </div>
      ) : null}

      {searchQuery.trim() && searchResults.length === 0 && !loading ? (
        <Alert
          type="info"
          showIcon
          message="No matches"
          description="Try another phrase, switch to Document scope, or use OCR for scanned pages."
          className={styles.noResults}
        />
      ) : null}

      {searchQuery.trim() && searchResults.length > 0 ? (
        <List
          size="small"
          className={styles.resultsList}
          dataSource={[...searchResults]}
          renderItem={(result: PdfTextSearchResult, index) => (
            <List.Item
              className={index === activeResultIndex ? styles.resultActive : styles.resultItem}
              actions={[
                <Button
                  key="go"
                  type="link"
                  size="small"
                  onClick={() => focusSearchResult(index)}
                >
                  Go
                </Button>,
                <Button
                  key="replace"
                  type="link"
                  size="small"
                  onClick={() => {
                    focusSearchResult(index)
                    openReplaceForMatch(result, replaceText.trim() || undefined)
                  }}
                >
                  Replace…
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={4} wrap>
                    <Tag color="blue">Selectable PDF</Tag>
                    <Text ellipsis style={{ maxWidth: 140 }}>
                      {result.matchText}
                    </Text>
                    <Tag>Page {result.pageIndex + 1}</Tag>
                    {result.positionReliability === 'low' ? (
                      <Tag color="warning">Low position</Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {formatMatchPosition(result)}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      ) : !searchQuery.trim() ? (
        <List
          size="small"
          className={styles.resultsList}
          header={<Text strong>Text on this page</Text>}
          dataSource={[...pageItems]}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <>
                    No selectable text on this page. Scanned or image-only content requires{' '}
                    <Text strong>OCR</Text> — ordinary PDF text replace will not edit pixels
                    inside images.
                  </>
                }
              />
            ),
          }}
          renderItem={(item) => (
            <List.Item
              className={selectedItem?.id === item.id ? styles.resultActive : styles.resultItem}
              actions={[
                <Button
                  key="select"
                  type="link"
                  size="small"
                  onClick={() => selectItemById(item.id, item.pageIndex)}
                >
                  Select
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={4} wrap>
                    <Tag color="blue">Selectable PDF</Tag>
                    <Text ellipsis style={{ maxWidth: 180 }}>
                      {item.text.trim() || '(empty)'}
                    </Text>
                    {item.positionReliability === 'low' ? (
                      <Tag color="warning">Low confidence</Tag>
                    ) : null}
                  </Space>
                }
                description={
                  <Text type="secondary">
                    {item.fontName} · {Math.round(item.fontSizePt * 10) / 10} pt
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      ) : null}

      {selectedItem ? (
        <div className={styles.selectionBox}>
          <Text strong>Selected item</Text>
          <Paragraph className={styles.selectedText}>{selectedItem.text}</Paragraph>
          <Space wrap>
            <Button size="small" type="primary" onClick={openReplaceForWholeItem}>
              Replace entire item…
            </Button>
            {activeSearchResult ? (
              <Button
                size="small"
                onClick={() => openReplaceForMatch(activeSearchResult)}
              >
                Replace active match…
              </Button>
            ) : null}
          </Space>
        </div>
      ) : null}

      <TextReplacementWorkflowModal
        open={replaceModalOpen}
        item={selectedItem}
        initialBounds={adjustmentBounds}
        initialReplacementText={modalReplacementSeed}
        searchMatch={modalSearchMatch}
        onClose={() => {
          setReplaceModalOpen(false)
          setModalReplacementSeed(undefined)
          setModalSearchMatch(null)
        }}
      />
    </div>
  )
}
