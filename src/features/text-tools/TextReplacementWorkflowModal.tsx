import { Alert, Button, Form, Input, InputNumber, Modal, Space, Tag, Tooltip, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { TextReplacementPreview } from '@/features/text-tools/TextReplacementPreview'
import { TextReplacementStyleControls } from '@/features/text-tools/TextReplacementStyleControls'
import { useTextReplacementPlanOverrides } from '@/features/text-tools/useTextReplacementPlanOverrides'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import {
  buildTextReplacementPlan,
  fidelityStatusLabel,
} from '@/lib/pdf/buildTextReplacementPlan'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import { mapPdfFontName } from '@/lib/pdf/mapPdfFontName'
import { samplePdfRectColors } from '@/lib/pdf/samplePdfRectColors'
import { assessTextReplacementCapability } from '@/lib/pdf/textReplacementCapability'
import type { ExtractedPdfTextItem, PdfTextSearchResult } from '@/types/pdfTextInspection'
import type { PageRect } from '@/types'
import styles from './TextReplacementWorkflowModal.module.css'

const { Text, Paragraph } = Typography

interface TextReplacementWorkflowModalProps {
  open: boolean
  item: ExtractedPdfTextItem | null
  initialBounds: PageRect | null
  initialReplacementText?: string
  /** When set, only the matched substring is covered (find/replace). */
  searchMatch?: PdfTextSearchResult | null
  onClose: () => void
}

export function TextReplacementWorkflowModal({
  open,
  item,
  initialBounds,
  initialReplacementText,
  searchMatch = null,
  onClose,
}: TextReplacementWorkflowModalProps) {
  const { applyOverlayTextCorrection, canUndo } = useEditorSession()
  const { getPageMeta } = usePdfViewer()
  const { setPendingTextReplacement, setPreviewMode } = useEditorPreview()
  const [replacementText, setReplacementText] = useState('')
  const [bounds, setBounds] = useState<PageRect | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(
    null,
  )

  const matchMode = Boolean(searchMatch)

  useEffect(() => {
    if (item && open) {
      if (searchMatch) {
        setReplacementText(initialReplacementText ?? searchMatch.matchText)
        setBounds(initialBounds ?? searchMatch.matchBounds)
      } else {
        setReplacementText(initialReplacementText ?? item.text.trim())
        setBounds(initialBounds ?? item.bounds)
      }
      setPreviewMode('side-by-side')
      void getPageMeta(item.pageIndex).then((meta) => {
        if (meta) {
          setPageSize({ width: meta.width, height: meta.height })
        }
      })
    }
  }, [item, initialBounds, initialReplacementText, open, getPageMeta, setPreviewMode, searchMatch])

  useEffect(() => {
    if (!open) {
      setPendingTextReplacement(null)
    }
  }, [open, setPendingTextReplacement])

  const assessment = useMemo(
    () => (item ? assessTextReplacementCapability(item) : null),
    [item],
  )

  const mappedFont = useMemo(
    () => (item ? mapPdfFontName(item.fontName) : null),
    [item],
  )

  const colorSample = useMemo(() => {
    if (!item || !bounds || !pageSize || !open) {
      return null
    }
    return samplePdfRectColors(
      item.pageIndex + 1,
      pageSize.width,
      pageSize.height,
      bounds,
    )
  }, [item, bounds, pageSize, open])

  const basePlan = useMemo(() => {
    if (!item || !bounds) {
      return null
    }
    return buildTextReplacementPlan({
      item,
      replacementText,
      bounds,
      colorSample,
      editSource: 'pdf_text',
      originalTextForSizing:
        matchMode && searchMatch ? searchMatch.matchText : undefined,
    })
  }, [item, replacementText, bounds, colorSample, matchMode, searchMatch])

  const styleResetKey =
    item && open
      ? `${item.id}:${searchMatch?.matchStartIndex ?? 'whole'}:${open}`
      : null
  const { plan, patchOverrides } = useTextReplacementPlanOverrides(
    basePlan,
    styleResetKey,
  )

  useEffect(() => {
    if (!open || !item || !plan) {
      return
    }
    setPendingTextReplacement({
      pageIndex: item.pageIndex,
      originalText: matchMode && searchMatch ? searchMatch.matchText : item.text,
      replacementText,
      plan,
    })
  }, [open, item, plan, replacementText, setPendingTextReplacement, matchMode, searchMatch])

  if (!item || !bounds || !plan) {
    return null
  }

  const handleApply = (): void => {
    applyOverlayTextCorrection(
      planToOverlayCorrectionInput({
        pageIndex: item.pageIndex,
        originalText: matchMode && searchMatch ? searchMatch.matchText : item.text,
        replacementText,
        plan,
      }),
    )
    setPendingTextReplacement(null)
    onClose()
  }

  const handleCancel = (): void => {
    setPendingTextReplacement(null)
    onClose()
  }

  const showApproximateWarning =
    plan.fidelityStatus !== 'original_style_matched' ||
    !mappedFont?.isExactFamilyMatch

  const fidelityTagColor =
    plan.fidelityStatus === 'original_style_matched'
      ? 'success'
      : plan.fidelityStatus === 'background_reconstruction_required'
        ? 'warning'
        : 'processing'

  return (
    <Modal
      title="Review text replacement"
      open={open}
      onCancel={handleCancel}
      footer={
        <Space wrap>
          <Tooltip title="Discards this preview — your upload is unchanged until you apply.">
            <Button onClick={handleCancel}>Cancel</Button>
          </Tooltip>
          <Tooltip title="Adds a mask and text overlay. Original PDF bytes stay intact. Use Undo (Ctrl+Z) to revert.">
            <Button type="primary" onClick={handleApply} disabled={!replacementText.trim()}>
              Apply correction
            </Button>
          </Tooltip>
        </Space>
      }
      width={620}
      destroyOnHidden
    >
      <Tag color={fidelityTagColor} className={styles.fidelityTag}>
        {fidelityStatusLabel(plan.fidelityStatus)}
      </Tag>

      <Alert
        type="info"
        showIcon
        message="On-page preview (dashed cyan)"
        description="The canvas shows this replacement at PDF coordinates before you commit. Side-by-side mode compares the upload with your existing edits."
        style={{ marginBottom: 12, marginTop: 8 }}
      />

      {showApproximateWarning ? (
        <Alert
          type="warning"
          showIcon
          message="Approximate font or background match"
          description="Font and colors are inferred from the PDF preview when possible. Verify the dashed on-page preview before applying."
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {assessment ? (
        <Alert
          type={assessment.mode === 'overlay_recommended' ? 'info' : 'warning'}
          showIcon
          message={assessment.headline}
          description={assessment.reasons.join(' ')}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Form layout="vertical" size="small">
        <Form.Item
          label={matchMode ? 'PDF text item (selectable)' : 'Original (detected in PDF)'}
        >
          <Input.TextArea value={item.text} readOnly rows={2} aria-readonly />
        </Form.Item>
        {matchMode && searchMatch ? (
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
            Matched phrase: “{searchMatch.matchText}” (characters{' '}
            {searchMatch.matchStartIndex + 1}–{searchMatch.matchEndIndex} in this item)
          </Paragraph>
        ) : null}
        <Form.Item
          label={matchMode ? 'Replacement for matched phrase' : 'Replacement'}
          extra={
            matchMode
              ? 'Only the matched phrase is masked and redrawn as an overlay — not native PDF editing.'
              : 'Edit only what changes (e.g. 5784 → 5884). Preview updates on the page.'
          }
        >
          <Input.TextArea
            value={replacementText}
            onChange={(event) => setReplacementText(event.target.value)}
            rows={2}
            aria-label="Replacement text"
          />
        </Form.Item>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          {matchMode && searchMatch
            ? `Before: “${searchMatch.matchText}” → After: “${replacementText.trim() || '…'}”`
            : `Before: “${item.text.trim()}” → After: “${replacementText.trim() || '…'}”`}
        </Paragraph>

        <TextReplacementStyleControls
          plan={plan}
          pdfFontName={item.fontName}
          onPatch={patchOverrides}
        />

        <div className={styles.metaGrid}>
          <Text type="secondary">
            PDF font: <Text code>{item.fontName}</Text>
          </Text>
          <Text type="secondary">
            Overlay font: {mappedFont?.family}
            {mappedFont?.weight === 'bold' ? ' (bold)' : ''}
            {!mappedFont?.isExactFamilyMatch ? ' — approximate' : ''}
          </Text>
          <Text type="secondary">Size: {Math.round(plan.fontSize * 10) / 10} pt</Text>
          <Text type="secondary">Color: {plan.color}</Text>
          <Text type="secondary">Mask fill: {plan.maskFillColor}</Text>
        </div>

        <TextReplacementPreview
          replacementText={replacementText}
          fontFamily={plan.fontFamily}
          fontSizePt={plan.fontSize}
          color={plan.color}
          fontWeight={plan.fontWeight}
          maskFillColor={plan.maskFillColor}
        />

        {plan.fidelityNotes.length > 0 ? (
          <ul className={styles.notes}>
            {plan.fidelityNotes.map((note) => (
              <li key={note}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {note}
                </Text>
              </li>
            ))}
          </ul>
        ) : null}

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {canUndo
            ? 'After applying, use Undo (Ctrl+Z) to remove the last committed correction.'
            : 'Apply creates overlay objects you can undo with Ctrl+Z.'}
        </Text>

        <Text strong style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          Cover region (PDF points)
        </Text>
        <Space wrap style={{ marginTop: 8 }}>
          <Form.Item label="X" style={{ marginBottom: 0 }}>
            <InputNumber
              value={Math.round(bounds.x * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, x: Number(value ?? bounds.x) })
              }
              aria-label="Cover X"
            />
          </Form.Item>
          <Form.Item label="Y" style={{ marginBottom: 0 }}>
            <InputNumber
              value={Math.round(bounds.y * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, y: Number(value ?? bounds.y) })
              }
              aria-label="Cover Y"
            />
          </Form.Item>
          <Form.Item label="Width" style={{ marginBottom: 0 }}>
            <InputNumber
              min={8}
              value={Math.round(bounds.width * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, width: Number(value ?? bounds.width) })
              }
              aria-label="Cover width"
            />
          </Form.Item>
          <Form.Item label="Height" style={{ marginBottom: 0 }}>
            <InputNumber
              min={8}
              value={Math.round(bounds.height * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, height: Number(value ?? bounds.height) })
              }
              aria-label="Cover height"
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  )
}
