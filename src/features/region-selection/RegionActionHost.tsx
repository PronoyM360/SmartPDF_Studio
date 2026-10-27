import { CopyOutlined, ScanOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, Button, Input, Modal, Progress, Space, Spin, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { useRegionSelection } from '@/features/region-selection/RegionSelectionContext'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'
import { SectionActionModal, type SectionActionTarget } from '@/features/sections/SectionActionModal'
import { getOcrLanguagePack } from '@/lib/ocr/languages'
import { extractPageTextItems } from '@/lib/pdf/extractPageText'
import { createPageDisplayTransform, pdfRectToScreenBounds } from '@/lib/pdf'
import { analyzeRegion, type RegionAnalysis } from '@/lib/redaction/browserPdfTools'
import { textInsideRegion } from '@/lib/regionSelection/regionGeometry'
import type { RegionSelection } from '@/lib/regionSelection/selectionState'
import { ANNOTATION_COLORS } from '@/types/annotationOverlay'
import type { PageRect } from '@/types'
import styles from './RegionActionHost.module.css'

const { Text, Paragraph } = Typography

interface TextFinding {
  readonly text: string
  readonly count: number
}

type AnalysisState =
  | { status: 'running' }
  | { status: 'ready'; pdfText: TextFinding; background: RegionAnalysis | null }
  | { status: 'error'; error: string }

function RegionAnalysisModal({ selection, onClose }: { selection: RegionSelection; onClose: () => void }) {
  const { pdf } = usePdfViewer()
  const { currentPageIndex } = useRegionSelection()
  const { addManualSection } = useDocumentSections()
  const ocr = useOcrSession()
  const [state, setState] = useState<AnalysisState>({ status: 'running' })
  const [ocrRequested, setOcrRequested] = useState(false)
  const [toDisplay, setToDisplay] = useState<((rect: PageRect) => PageRect) | null>(null)

  useEffect(() => {
    if (!pdf) {
      return
    }
    let cancelled = false
    let background: RegionAnalysis | null = null
    void (async () => {
      try {
        const page = await pdf.getPage(selection.pageIndex + 1)
        const transform = createPageDisplayTransform(selection.pageIndex, page.getViewport({ scale: 1 }))
        const display = (rect: PageRect): PageRect => pdfRectToScreenBounds(transform, rect)
        const items = await extractPageTextItems(pdf, selection.pageIndex)
        const inside = textInsideRegion(items, selection.bounds, display)
        background = await analyzeRegion(pdf, selection.pageIndex, selection.bounds).catch(() => null)
        if (cancelled) {
          background?.release()
          return
        }
        setToDisplay(() => display)
        setState({
          status: 'ready',
          pdfText: { text: inside.text, count: inside.items.length },
          background,
        })
      } catch (cause) {
        if (!cancelled) {
          setState({ status: 'error', error: cause instanceof Error ? cause.message : 'Could not analyse this region.' })
        }
      }
    })()
    return () => {
      cancelled = true
      background?.release()
    }
  }, [pdf, selection.pageIndex, selection.bounds])

  const ocrBusy =
    ocr.job.status === 'rendering' || ocr.job.status === 'loading-worker' || ocr.job.status === 'recognizing'
  const ocrAvailable = getOcrLanguagePack(ocr.languageId).available
  const onCurrentPage = selection.pageIndex === currentPageIndex
  const ocrText = useMemo((): TextFinding | null => {
    if (!ocrRequested || ocrBusy || !toDisplay || ocr.pageResult?.pageIndex !== selection.pageIndex) {
      return null
    }
    const words = ocr.pageResult.items.filter((item) => item.kind === 'word')
    const inside = textInsideRegion(words, selection.bounds, toDisplay)
    return { text: inside.text, count: inside.items.length }
  }, [ocrRequested, ocrBusy, toDisplay, ocr.pageResult, selection])

  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(
      () => message.success('Copied to clipboard'),
      () => message.warning('Copy is not available in this browser'),
    )
  }

  const saveAsSection = (): void => {
    addManualSection(selection.pageIndex, selection.bounds)
    message.success('Saved as a section — find it in the Sections tab.')
  }

  return (
    <Modal
      open
      title={`Analyze region · page ${selection.pageIndex + 1}`}
      onCancel={onClose}
      width={560}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={saveAsSection}>Save as section</Button>
          <Button type="primary" onClick={onClose}>
            Done
          </Button>
        </Space>
      }
    >
      {state.status === 'running' ? (
        <div className={styles.loading}>
          <Spin size="small" /> <Text type="secondary">Reading the region…</Text>
        </div>
      ) : null}
      {state.status === 'error' ? <Alert type="error" showIcon message={state.error} /> : null}
      {state.status === 'ready' ? (
        <div className={styles.body}>
          {state.background ? (
            <figure className={styles.figure}>
              <img src={state.background.beforeUrl} alt="Selected region" />
              <figcaption>
                <Tag color={state.background.background === 'solid' ? 'success' : 'warning'}>
                  {state.background.background === 'solid' ? 'Flat background' : 'Varied background'}
                </Tag>
                {state.background.background === 'solid'
                  ? 'A matching cover would blend in.'
                  : 'Gradients, photos or patterns: any flat cover will be visible as a box.'}
              </figcaption>
            </figure>
          ) : null}

          <Text strong>Selectable PDF text</Text>
          {state.pdfText.count > 0 ? (
            <>
              <Input.TextArea value={state.pdfText.text} readOnly autoSize={{ minRows: 2, maxRows: 8 }} aria-label="Text in region" />
              <Space className={styles.row}>
                <Text type="secondary">{state.pdfText.count} text item(s) at least half inside the region.</Text>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copy(state.pdfText.text)}>
                  Copy
                </Button>
              </Space>
            </>
          ) : (
            <Paragraph type="secondary">No selectable text in this region. It may be part of an image or scan.</Paragraph>
          )}

          <Text strong>Text in images (OCR)</Text>
          {!ocrAvailable ? (
            <Paragraph type="secondary">OCR is not available for the selected language.</Paragraph>
          ) : !onCurrentPage ? (
            <Paragraph type="secondary">Go to page {selection.pageIndex + 1} to read this region with OCR.</Paragraph>
          ) : (
            <>
              <Space className={styles.row}>
                <Button
                  size="small"
                  icon={<ScanOutlined />}
                  disabled={ocrBusy}
                  onClick={() => {
                    setOcrRequested(true)
                    ocr.runOcrOnRegion(selection.bounds)
                  }}
                >
                  {ocrRequested ? 'Read again' : 'Read with OCR'}
                </Button>
                {ocrBusy ? (
                  <Button size="small" icon={<StopOutlined />} onClick={ocr.cancelOcr}>
                    Cancel OCR
                  </Button>
                ) : null}
              </Space>
              {ocrBusy ? (
                <Progress percent={Math.round(ocr.job.progress * 100)} size="small" status="active" />
              ) : null}
              {ocrText ? (
                ocrText.count > 0 ? (
                  <>
                    <Input.TextArea value={ocrText.text} readOnly autoSize={{ minRows: 2, maxRows: 8 }} aria-label="OCR text in region" />
                    <Text type="secondary" className={styles.note}>
                      OCR estimates — check them. To change this text, use the OCR tab, where the words found here are listed.
                    </Text>
                  </>
                ) : (
                  <Text type="secondary">OCR found no readable text here.</Text>
                )
              ) : null}
              {ocr.job.status === 'error' && ocrRequested ? <Alert type="error" showIcon message={ocr.job.error} /> : null}
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

function AnnotationModal({ selection, onClose }: { selection: RegionSelection; onClose: () => void }) {
  const { addAnnotationObject, undo } = useEditorSession()
  const [note, setNote] = useState('')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])

  const apply = (): void => {
    addAnnotationObject({ pageIndex: selection.pageIndex, bounds: selection.bounds, note: note.trim(), color })
    const key = `annotation-${Date.now()}`
    message.open({
      key,
      type: 'success',
      duration: 6,
      content: (
        <span>
          Annotation added on page {selection.pageIndex + 1}.{' '}
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
    onClose()
  }

  return (
    <Modal
      open
      title="Add annotation"
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!note.trim()} onClick={apply}>
            Add annotation
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary">
        Adds a standard PDF comment with an outline around the region. The page content is not
        changed, and anyone with the file can hide or delete the annotation.
      </Paragraph>
      <Input.TextArea
        autoFocus
        rows={4}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Write a note about this area…"
        aria-label="Annotation note"
      />
      <Space size={6} className={styles.swatches}>
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={swatch === color ? styles.swatchActive : styles.swatch}
            style={{ background: swatch }}
            aria-label={`Annotation colour ${swatch}`}
            aria-pressed={swatch === color}
            onClick={() => setColor(swatch)}
          />
        ))}
      </Space>
    </Modal>
  )
}

/** Opens the dialog for the action picked on the selection bar or panel. */
export function RegionActionHost() {
  const { selection, activeAction, closeAction } = useRegionSelection()

  const coverTargets = useMemo((): SectionActionTarget[] => {
    if (!selection) {
      return []
    }
    return [
      {
        pageIndex: selection.pageIndex,
        bounds: selection.bounds,
        label: 'Selected region',
      },
    ]
  }, [selection])

  if (!selection || !activeAction) {
    return null
  }
  if (activeAction === 'analyze') {
    return <RegionAnalysisModal key={JSON.stringify(selection)} selection={selection} onClose={closeAction} />
  }
  if (activeAction === 'annotate') {
    return <AnnotationModal selection={selection} onClose={closeAction} />
  }
  return <SectionActionModal action={activeAction} targets={coverTargets} onClose={closeAction} />
}
