import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { TextReplacementPreview } from '@/features/text-tools/TextReplacementPreview'
import { TextReplacementStyleControls } from '@/features/text-tools/TextReplacementStyleControls'
import { useTextReplacementPlanOverrides } from '@/features/text-tools/useTextReplacementPlanOverrides'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { ocrConfidenceLabel } from '@/lib/ocr/ocrConfidence'
import {
  buildTextReplacementPlan,
  fidelityStatusLabel,
} from '@/lib/pdf/buildTextReplacementPlan'
import { planToOverlayCorrectionInput } from '@/lib/pdf/planToOverlayCorrection'
import { samplePdfRectColors } from '@/lib/pdf/samplePdfRectColors'
import type { OcrTextItem } from '@/types/ocr'
import type { ExtractedPdfTextItem } from '@/types/pdfTextInspection'
import type { PageRect } from '@/types'

const { Text, Paragraph } = Typography

interface OcrEditWorkflowModalProps {
  open: boolean
  item: OcrTextItem | null
  recognizedText: string
  correctedText: string
  initialBounds: PageRect | null
  priceMatchCount: number
  onClose: () => void
}

export function OcrEditWorkflowModal({
  open,
  item,
  recognizedText,
  correctedText: initialCorrected,
  initialBounds,
  priceMatchCount,
  onClose,
}: OcrEditWorkflowModalProps) {
  const { applyOverlayTextCorrection, canUndo } = useEditorSession()
  const { getPageMeta } = usePdfViewer()
  const { setPendingTextReplacement, setPreviewMode } = useEditorPreview()
  const [replacementText, setReplacementText] = useState('')
  const [bounds, setBounds] = useState<PageRect | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(
    null,
  )

  useEffect(() => {
    if (item && open) {
      setReplacementText(initialCorrected)
      setBounds(initialBounds ?? item.bounds)
      setConfirmed(false)
      setPreviewMode('side-by-side')
      void getPageMeta(item.pageIndex).then((meta) => {
        if (meta) {
          setPageSize({ width: meta.width, height: meta.height })
        }
      })
    }
  }, [item, initialBounds, initialCorrected, open, getPageMeta, setPreviewMode])

  useEffect(() => {
    if (!open) {
      setPendingTextReplacement(null)
    }
  }, [open, setPendingTextReplacement])

  const pseudoPdfItem = useMemo((): ExtractedPdfTextItem | null => {
    if (!item || !bounds) {
      return null
    }
    return {
      id: item.id,
      pageIndex: item.pageIndex,
      text: recognizedText,
      bounds,
      fontName: 'OCR-scanned',
      fontSizePt: bounds.height * 0.72,
      positionReliability: 'low',
    }
  }, [item, bounds, recognizedText])

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
    if (!pseudoPdfItem || !bounds) {
      return null
    }
    return buildTextReplacementPlan({
      item: pseudoPdfItem,
      replacementText,
      bounds,
      colorSample,
      editSource: 'ocr',
      originalTextForSizing: recognizedText,
    })
  }, [pseudoPdfItem, replacementText, bounds, colorSample, recognizedText])

  const styleResetKey = item && open ? `${item.id}:${open}` : null
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
      originalText: recognizedText,
      replacementText,
      plan,
    })
  }, [open, item, plan, replacementText, recognizedText, setPendingTextReplacement])

  const needsExplicitConfirm = useMemo(() => {
    if (!item) {
      return false
    }
    if (item.tags.includes('price') && priceMatchCount > 1) {
      return true
    }
    return item.tags.includes('price') || item.tags.includes('quantity')
  }, [item, priceMatchCount])

  if (!item || !bounds || !plan) {
    return null
  }

  const handleApply = (): void => {
    applyOverlayTextCorrection(
      planToOverlayCorrectionInput({
        pageIndex: item.pageIndex,
        originalText: recognizedText,
        replacementText,
        plan,
        editSource: 'ocr',
      }),
    )
    setPendingTextReplacement(null)
    onClose()
  }

  const handleCancel = (): void => {
    setPendingTextReplacement(null)
    onClose()
  }

  const complexBackground =
    plan.fidelityStatus === 'background_reconstruction_required' ||
    colorSample?.backgroundKind === 'complex'

  return (
    <Modal
      title="Review OCR-assisted correction"
      open={open}
      onCancel={handleCancel}
      footer={
        <Space wrap>
          <Tooltip title="Discards preview — the PDF file is unchanged until you apply.">
            <Button onClick={handleCancel}>Cancel</Button>
          </Tooltip>
          <Tooltip title="Adds a mask and text overlay. Original scan/image pixels remain. Undo with Ctrl+Z.">
            <Button
              type="primary"
              onClick={handleApply}
              disabled={
                !replacementText.trim() || (needsExplicitConfirm && !confirmed)
              }
            >
              Apply correction
            </Button>
          </Tooltip>
        </Space>
      }
      width={620}
      destroyOnHidden
    >
      <Tag color="warning">{fidelityStatusLabel(plan.fidelityStatus)}</Tag>
      <Tag style={{ marginLeft: 6 }}>{ocrConfidenceLabel(item.confidence)}</Tag>

      <Alert
        type="warning"
        showIcon
        message="OCR estimate — not original PDF text"
        description="Tesseract guesses text and position from pixels. Overlays approximate font and background; they cannot perfectly reproduce the original scan."
        style={{ marginBottom: 12, marginTop: 8 }}
      />

      <Alert
        type="info"
        showIcon
        message="On-page preview (dashed cyan)"
        description="The canvas shows this overlay at estimated coordinates before commit. Side-by-side mode keeps the original upload visible for comparison."
        style={{ marginBottom: 12 }}
      />

      {complexBackground ? (
        <Alert
          type="error"
          showIcon
          message="Complex background"
          description="A flat mask may not reconstruct photos, gradients, or busy patterns. Adjust the cover region or verify visually before applying."
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {priceMatchCount > 1 ? (
        <Alert
          type="warning"
          showIcon
          message="Multiple amounts detected on this page"
          description="Review each price individually. The app will not replace every number automatically."
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Form layout="vertical" size="small">
        <Form.Item label="Recognized (OCR estimate — edit before applying)">
          <Input.TextArea value={recognizedText} readOnly rows={2} aria-readonly />
        </Form.Item>
        <Form.Item
          label="Corrected replacement"
          extra="Fix OCR mistakes here. This text is drawn as an overlay — not written into the PDF."
        >
          <Input.TextArea
            value={replacementText}
            onChange={(event) => setReplacementText(event.target.value)}
            rows={2}
            aria-label="Corrected replacement text"
          />
        </Form.Item>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
          Before: “{recognizedText.trim()}” → After: “{replacementText.trim() || '…'}”
        </Paragraph>

        <TextReplacementStyleControls plan={plan} onPatch={patchOverrides} />

        <TextReplacementPreview
          replacementText={replacementText}
          fontFamily={plan.fontFamily}
          fontSizePt={plan.fontSize}
          color={plan.color}
          fontWeight={plan.fontWeight}
          maskFillColor={plan.maskFillColor}
        />

        {plan.fidelityNotes.length > 0 ? (
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
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
          Approximate target region (PDF points)
        </Text>
        <Space wrap style={{ marginTop: 8 }}>
          <Form.Item label="X" style={{ marginBottom: 0 }}>
            <InputNumber
              value={Math.round(bounds.x * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, x: Number(value ?? bounds.x) })
              }
            />
          </Form.Item>
          <Form.Item label="Y" style={{ marginBottom: 0 }}>
            <InputNumber
              value={Math.round(bounds.y * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, y: Number(value ?? bounds.y) })
              }
            />
          </Form.Item>
          <Form.Item label="Width" style={{ marginBottom: 0 }}>
            <InputNumber
              min={8}
              value={Math.round(bounds.width * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, width: Number(value ?? bounds.width) })
              }
            />
          </Form.Item>
          <Form.Item label="Height" style={{ marginBottom: 0 }}>
            <InputNumber
              min={8}
              value={Math.round(bounds.height * 10) / 10}
              onChange={(value) =>
                setBounds({ ...bounds, height: Number(value ?? bounds.height) })
              }
            />
          </Form.Item>
        </Space>
      </Form>

      {needsExplicitConfirm ? (
        <Checkbox
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          style={{ marginTop: 12 }}
        >
          I confirm this is the exact value I want to change on the page.
        </Checkbox>
      ) : null}
    </Modal>
  )
}
