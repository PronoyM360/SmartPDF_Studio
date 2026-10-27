import { Alert, Button, Input, Modal, Segmented, Space, Spin, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import { analyzeRegion, type RegionAnalysis } from '@/lib/redaction/browserPdfTools'
import { MASK_MODE_LABELS } from '@/lib/redaction/maskModes'
import type { PageRect } from '@/types'
import styles from './SectionActionModal.module.css'

const { Text, Paragraph } = Typography

export type SectionAction = 'hide' | 'cover' | 'redact'

export interface SectionActionTarget {
  readonly pageIndex: number
  readonly bounds: PageRect
  readonly label: string
  readonly sectionId?: string
}

interface SectionActionModalProps {
  action: SectionAction | null
  targets: readonly SectionActionTarget[]
  onClose: () => void
}

type CoverColorChoice = 'match' | 'white' | 'custom'

const PREVIEW_LIMIT = 3
const NEAR_WHITE = 12

const COPY: Record<SectionAction, { title: string; ok: string }> = {
  hide: { title: 'Hide in editor preview', ok: 'Hide' },
  cover: { title: 'Cover with a visual mask', ok: 'Add cover' },
  redact: { title: 'Redact (remove permanently on download)', ok: 'Mark for redaction' },
}

function resolveFill(
  action: SectionAction | null,
  analysis: RegionAnalysis | null,
  coverChoice: CoverColorChoice,
  customColor: string,
  redactColor: string,
): string {
  if (action === 'redact') {
    return redactColor
  }
  if (coverChoice === 'white') {
    return '#ffffff'
  }
  if (coverChoice === 'custom') {
    return normalizeHexForColorInput(customColor, '#ffffff')
  }
  return analysis?.surroundingColor ?? '#ffffff'
}

function isNearWhite(hex: string): boolean {
  const body = normalizeHexForColorInput(hex, '#ffffff').slice(1)
  return [0, 2, 4].every((offset) => 255 - Number.parseInt(body.slice(offset, offset + 2), 16) <= NEAR_WHITE)
}

/** Preview + confirmation for applying hide / cover / redact to one or more regions. */
export function SectionActionModal({ action, targets, onClose }: SectionActionModalProps) {
  const { pdf } = usePdfViewer()
  const { addMaskObjectsWithBounds, undo } = useEditorSession()
  const [analyses, setAnalyses] = useState<(RegionAnalysis | null)[]>([])
  const [loading, setLoading] = useState(false)
  const [coverChoice, setCoverChoice] = useState<CoverColorChoice>('match')
  const [customColor, setCustomColor] = useState('#ffffff')
  const [redactColor, setRedactColor] = useState<'#000000' | '#ffffff'>('#000000')

  const open = action !== null && targets.length > 0

  useEffect(() => {
    if (!open || !pdf) {
      return
    }
    let cancelled = false
    const created: RegionAnalysis[] = []
    setLoading(true)
    setCoverChoice('match')
    setRedactColor('#000000')
    void (async () => {
      const results: (RegionAnalysis | null)[] = []
      for (const target of targets) {
        try {
          const analysis = await analyzeRegion(pdf, target.pageIndex, target.bounds)
          created.push(analysis)
          results.push(analysis)
        } catch {
          results.push(null)
        }
        if (cancelled) {
          return
        }
      }
      if (!cancelled) {
        setAnalyses(results)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      for (const analysis of created) {
        analysis.release()
      }
      setAnalyses([])
    }
  }, [open, pdf, targets])

  const fillFor = (index: number): string =>
    resolveFill(action, analyses[index] ?? null, coverChoice, customColor, redactColor)

  const complexCount = analyses.filter((analysis) => analysis?.background === 'complex').length
  const unknownCount = analyses.filter((analysis) => analysis === null).length
  const whiteOnColour =
    action !== 'redact' &&
    coverChoice === 'white' &&
    analyses.some(
      (analysis) =>
        analysis && (analysis.background === 'complex' || !isNearWhite(analysis.surroundingColor)),
    )
  const pages = [...new Set(targets.map((target) => target.pageIndex + 1))].sort((a, b) => a - b)

  const previews = useMemo(
    () =>
      analyses.slice(0, PREVIEW_LIMIT).map((analysis) =>
        analysis
          ? {
              before: analysis.beforeUrl,
              after: analysis.previewWithFill(
                resolveFill(action, analysis, coverChoice, customColor, redactColor),
              ),
            }
          : null,
      ),
    [analyses, action, coverChoice, customColor, redactColor],
  )

  const apply = (): void => {
    if (!action) {
      return
    }
    addMaskObjectsWithBounds(
      targets.map((target, index) => ({
        pageIndex: target.pageIndex,
        bounds: target.bounds,
        fillColor: fillFor(index),
        mode: action,
        label: target.label,
        sourceSectionId: target.sectionId,
      })),
    )
    const key = `section-action-${Date.now()}`
    const verb = action === 'hide' ? 'Hidden' : action === 'cover' ? 'Covered' : 'Marked for redaction'
    message.open({
      key,
      type: 'success',
      duration: 6,
      content: (
        <span>
          {verb}: {targets.length === 1 ? targets[0]!.label : `${targets.length} sections`}.{' '}
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
      open={open}
      title={action ? COPY[action].title : ''}
      onCancel={onClose}
      width={560}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            danger={action === 'redact'}
            disabled={loading}
            onClick={apply}
          >
            {action ? COPY[action].ok : 'Apply'}
          </Button>
        </Space>
      }
    >
      {action ? (
        <div className={styles.body}>
          <Paragraph className={styles.lead}>
            {targets.length === 1 ? (
              <Text strong>{targets[0]!.label}</Text>
            ) : (
              <Text strong>{targets.length} sections</Text>
            )}{' '}
            on page {pages.join(', ')}. {MASK_MODE_LABELS[action].long}
          </Paragraph>

          {action === 'hide' ? (
            <Alert
              type="info"
              showIcon
              message="The download is not affected"
              description="Use this to review the document without these parts. Restore it any time from Applied changes, or switch to the Original view."
            />
          ) : null}

          {action === 'cover' ? (
            <Alert
              type="warning"
              showIcon
              message="Not secure — the text stays in the file"
              description="Anyone can still select, copy or extract the content under a cover. For personal information, use Redact instead."
            />
          ) : null}

          {action === 'redact' ? (
            <Alert
              type="warning"
              showIcon
              message={`What happens to page ${pages.join(', ')} when you download`}
              description={
                <ul className={styles.list}>
                  <li>The page is turned into an image with this area filled, so the text and images underneath are removed from the file.</li>
                  <li>Other text on that page will look the same but is no longer selectable or searchable. Links and form fields on that page are removed.</li>
                  <li>Other pages are not changed.</li>
                  <li>The download is reopened and checked. If any redacted text is still found, download is blocked.</li>
                </ul>
              }
            />
          ) : null}

          {action === 'redact' ? (
            <Space className={styles.choice}>
              <Text>Fill</Text>
              <Segmented
                size="small"
                value={redactColor}
                onChange={(value) => setRedactColor(value as '#000000' | '#ffffff')}
                options={[
                  { value: '#000000', label: 'Black (standard)' },
                  { value: '#ffffff', label: 'White' },
                ]}
              />
            </Space>
          ) : (
            <Space className={styles.choice} wrap>
              <Text>Colour</Text>
              <Segmented
                size="small"
                value={coverChoice}
                onChange={(value) => setCoverChoice(value as CoverColorChoice)}
                options={[
                  { value: 'match', label: 'Match background' },
                  { value: 'white', label: 'White' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              {coverChoice === 'custom' ? (
                <Input
                  type="color"
                  size="small"
                  value={normalizeHexForColorInput(customColor, '#ffffff')}
                  onChange={(event) => setCustomColor(event.target.value)}
                  className={styles.colorInput}
                  aria-label="Custom cover colour"
                />
              ) : null}
            </Space>
          )}

          {action !== 'redact' && !loading && complexCount > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`Busy or coloured background around ${complexCount === 1 && targets.length === 1 ? 'this area' : `${complexCount} area(s)`}`}
              description="The background varies (gradient, photo or pattern), so no flat colour matches it. The cover will be visible as a box. Match background uses the average colour."
            />
          ) : null}
          {whiteOnColour ? (
            <Alert
              type="warning"
              showIcon
              message="White box on a non-white background"
              description="A white rectangle will stand out here. Match background usually looks more natural."
            />
          ) : null}
          {action !== 'redact' && !loading && unknownCount > 0 ? (
            <Alert
              type="info"
              showIcon
              message="Background could not be checked"
              description="The page could not be rendered for analysis; white is used for those areas."
            />
          ) : null}

          {loading ? (
            <div className={styles.loading}>
              <Spin size="small" /> <Text type="secondary">Preparing preview…</Text>
            </div>
          ) : (
            <div className={styles.previews}>
              {previews.map((preview, index) =>
                preview ? (
                  <div key={targets[index]!.label + index} className={styles.previewRow}>
                    <figure className={styles.figure}>
                      <img src={preview.before} alt={`Before: ${targets[index]!.label}`} />
                      <figcaption>Before</figcaption>
                    </figure>
                    <figure className={styles.figure}>
                      <img src={preview.after} alt={`After: ${targets[index]!.label}`} />
                      <figcaption>
                        After
                        {action !== 'redact' && analyses[index]
                          ? analyses[index]!.background === 'solid'
                            ? ' · solid background'
                            : ' · busy background'
                          : ''}
                      </figcaption>
                    </figure>
                  </div>
                ) : null,
              )}
              {targets.length > PREVIEW_LIMIT ? (
                <Text type="secondary" className={styles.more}>
                  +{targets.length - PREVIEW_LIMIT} more not shown
                </Text>
              ) : null}
            </div>
          )}

          <Text type="secondary" className={styles.footnote}>
            Your original PDF is never changed. This adds an editing step you can undo (Ctrl+Z) or restore later.
          </Text>
        </div>
      ) : null}
    </Modal>
  )
}
