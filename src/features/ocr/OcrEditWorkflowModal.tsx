import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useEditorPreview } from '@/features/pdf-editor/EditorPreviewContext'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { OcrRepairPreview, type OcrPreviewText } from '@/features/ocr/OcrRepairPreview'
import { useOcrRegionRepair } from '@/features/ocr/useOcrRegionRepair'
import { createCanvasGlyphRasterizer } from '@/features/ocr/canvasGlyphRasterizer'
import { inkBounds, matchFontsToGlyphs } from '@/lib/ocr/fontShapeMatch'
import {
  canvasTextMetrics,
  isSystemFontAvailable,
  measureInkWidth,
} from '@/features/prices/canvasTextMetrics'
import { DEFAULT_TEXT_FONT_FAMILY, TEXT_FONT_FAMILIES } from '@/features/text-tools/textDefaults'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { ocrConfidenceLabel, ocrConfidenceTier } from '@/lib/ocr/ocrConfidence'
import {
  estimateFontWeight,
  inferOcrAlignment,
  layoutOcrReplacement,
  rankFontsByWidth,
  type NeighborText,
  type OverflowPolicy,
} from '@/lib/ocr/ocrTypography'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import { pdfRectToScreenBounds, screenRectToPdfRect } from '@/lib/pdf'
import type {
  BackgroundRepairChoice,
  BackgroundRepairMethod,
  RegionBackgroundKind,
} from '@/types/backgroundRepair'
import type { OcrTextItem } from '@/types/ocr'
import type { TextAlignment } from '@/types/textOverlay'
import type { PageRect } from '@/types'

const { Text, Paragraph } = Typography

const KIND_LABELS: Record<RegionBackgroundKind, string> = {
  solid: 'Solid background',
  gradient: 'Gradient background',
  lines: 'Background with lines',
  textured: 'Textured background',
  complex: 'Complex background',
}

const METHOD_LABELS: Record<BackgroundRepairMethod | 'flat-box', string> = {
  solid: 'solid colour fill',
  gradient: 'gradient fill',
  inpaint: 'local inpainting',
  'flat-box': 'flat cover box',
}

const SEAM_WARNING_SCORE = 12
/** Below this glyph overlap the shape comparison is noise (blurry or tiny text). */
const MIN_SHAPE_SIMILARITY = 0.35

interface OcrEditWorkflowModalProps {
  open: boolean
  item: OcrTextItem | null
  /** OCR text after the user fixed recognition mistakes in the panel. */
  correctedText: string
  initialBounds: PageRect | null
  priceMatchCount: number
  onClose: () => void
}

interface StyleOverrides {
  fontFamily?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  color?: string
  alignment?: TextAlignment
}

export function OcrEditWorkflowModal(props: OcrEditWorkflowModalProps) {
  // Remount per item so every edit starts from fresh estimates.
  return props.open && props.item ? (
    <OcrEditWorkflowDialog key={props.item.id} {...props} item={props.item} />
  ) : null
}

function OcrEditWorkflowDialog({
  open,
  item,
  correctedText,
  initialBounds,
  priceMatchCount,
  onClose,
}: OcrEditWorkflowModalProps & { item: OcrTextItem }) {
  const { applyOverlayTextCorrection, registerGeneratedImageAsset, canUndo } = useEditorSession()
  const { pdf } = usePdfViewer()
  const { setPendingTextReplacement, setPreviewMode } = useEditorPreview()
  const { pageResult, pageContent, setCorrectedText } = useOcrSession()

  const [scanText, setScanText] = useState(correctedText)
  const [replacementText, setReplacementText] = useState(correctedText)
  const [bounds, setBounds] = useState<PageRect>(initialBounds ?? item.bounds)
  const [choice, setChoice] = useState<BackgroundRepairChoice>('auto')
  const [overflow, setOverflow] = useState<OverflowPolicy>('extend')
  const [overrides, setOverrides] = useState<StyleOverrides>({})
  const [showRepairMask, setShowRepairMask] = useState(false)
  const [confirmedValue, setConfirmedValue] = useState(false)
  const [acceptedRisks, setAcceptedRisks] = useState(false)

  useEffect(() => {
    setPreviewMode('side-by-side')
    return () => setPendingTextReplacement(null)
  }, [setPreviewMode, setPendingTextReplacement])

  const repairState = useOcrRegionRepair({
    enabled: open,
    pdf,
    pageIndex: item.pageIndex,
    glyphBoundsPdf: bounds,
    choice,
    nativePixelsPerPoint: pageContent?.dominantImagePixelsPerPoint ?? null,
  })
  const result =
    repairState.status === 'ready'
      ? repairState.result
      : repairState.status === 'working'
        ? repairState.previous
        : null

  const neighbors = useMemo((): NeighborText[] => {
    if (!result) {
      return []
    }
    return (pageResult?.items ?? [])
      .filter((other) => other.kind === 'word' && other.id !== item.id)
      .map((other) => ({
        text: other.text,
        box: pdfRectToScreenBounds(result.baseTransform, other.bounds),
      }))
  }, [pageResult, item.id, result])

  const estimates = useMemo(() => {
    if (!result) {
      return null
    }
    const glyph = result.glyphDisplayBox
    const itemBox = pdfRectToScreenBounds(result.baseTransform, item.bounds)
    const fontSize = item.fontSizePt ?? itemBox.height / 0.93
    // The baseline follows the box's bottom edge, so growing the box upward to cover
    // remnants does not lift the new text.
    const baselineY =
      itemBox.y + (item.baselineFromTopPt ?? fontSize * 0.72) + (glyph.y + glyph.height - (itemBox.y + itemBox.height))
    const baselineFromTop = baselineY - glyph.y
    const weight = estimateFontWeight(result.analysis.strokeWidthPx, fontSize * result.pixelsPerPoint)
    const alignment = inferOcrAlignment(glyph, neighbors, fontSize)
    const families = [
      DEFAULT_TEXT_FONT_FAMILY,
      ...TEXT_FONT_FAMILIES.filter(
        (family) => family !== DEFAULT_TEXT_FONT_FAMILY && isSystemFontAvailable(family),
      ),
    ]
    const color = result.analysis.inkColor ?? '#0f172a'

    // Compare the scanned glyph pixels with each installed font (both weights).
    const { width: maskWidth, height: maskHeight } = result.analysisSize
    const scanMask = { data: result.analysis.inkMask, width: maskWidth, height: maskHeight }
    const rect = result.textRectPx
    const scanInk = inkBounds(scanMask, {
      x: Math.max(0, rect.x - 2),
      y: Math.max(0, rect.y - 2),
      width: Math.min(maskWidth, rect.x + rect.width + 2) - Math.max(0, rect.x - 2),
      height: Math.min(maskHeight, rect.y + rect.height + 2) - Math.max(0, rect.y - 2),
    })
    const shapes = scanInk
      ? matchFontsToGlyphs({
          text: scanText,
          scan: scanMask,
          scanInk,
          pixelsPerPoint: result.pixelsPerPoint,
          candidates: families.flatMap((family) => [
            { family, weight: 'normal' as const },
            { family, weight: 'bold' as const },
          ]),
          // The scan mask is cut halfway between paper and ink, so match at 50% coverage.
          rasterize: createCanvasGlyphRasterizer(0.5),
        })
      : []
    const best = shapes[0]
    const bestIsReliable =
      best !== undefined &&
      best.similarity >= MIN_SHAPE_SIMILARITY &&
      Math.abs(best.impliedSizePt / fontSize - 1) <= 0.35
    const widthRanked = rankFontsByWidth({
      text: scanText,
      boxWidth: glyph.width,
      fontSize,
      fontWeight: weight.weight,
      families,
      measure: measureInkWidth,
    })
    return {
      fontSize: bestIsReliable ? best.impliedSizePt : fontSize,
      ocrFontSize: fontSize,
      baselineFromTop,
      weight: bestIsReliable
        ? {
            weight: best.weight,
            note: `${best.weight === 'bold' ? 'Bold' : 'Regular'} strokes matched the scan best.`,
          }
        : weight,
      alignment,
      shapes: bestIsReliable ? shapes : [],
      widthRanked,
      family: bestIsReliable ? best.family : (widthRanked[0]?.family ?? DEFAULT_TEXT_FONT_FAMILY),
      color,
    }
  }, [result, item.bounds, item.fontSizePt, item.baselineFromTopPt, neighbors, scanText])

  const style = useMemo(() => {
    if (!estimates) {
      return null
    }
    return {
      fontFamily: overrides.fontFamily ?? estimates.family,
      fontSize: overrides.fontSize ?? estimates.fontSize,
      fontWeight: overrides.fontWeight ?? estimates.weight.weight,
      color: overrides.color ?? estimates.color,
      alignment: overrides.alignment ?? estimates.alignment.alignment,
    }
  }, [estimates, overrides])

  const fontOptions = useMemo(() => {
    if (!estimates) {
      return []
    }
    if (estimates.shapes.length > 0) {
      return estimates.shapes.slice(0, 14).map((match, index) => ({
        value: `${match.family}|${match.weight}`,
        label: `${match.family}${match.weight === 'bold' ? ' Bold' : ''} — ${Math.round(match.similarity * 100)}% shape match${index === 0 ? ' (closest)' : ''}`,
      }))
    }
    return estimates.widthRanked.flatMap((match) =>
      (['normal', 'bold'] as const).map((weight) => ({
        value: `${match.family}|${weight}`,
        label: `${match.family}${weight === 'bold' ? ' Bold' : ''} — ${Math.round(match.widthRatio * 100)}% of scanned width`,
      })),
    )
  }, [estimates])

  const selectFont = (value: string): void => {
    const [family = DEFAULT_TEXT_FONT_FAMILY, weight = 'normal'] = value.split('|')
    const match = estimates?.shapes.find((entry) => entry.family === family && entry.weight === weight)
    setOverrides((prev) => ({
      ...prev,
      fontFamily: family,
      fontWeight: weight === 'bold' ? 'bold' : 'normal',
      // Keep cap height equal to the scan when switching fonts.
      ...(match ? { fontSize: match.impliedSizePt } : {}),
    }))
  }

  const layout = useMemo(() => {
    if (!result || !estimates || !style) {
      return null
    }
    const content = replacementText.trim() || ' '
    const width =
      canvasTextMetrics.measureWidth(content, style.fontFamily, style.fontWeight, style.fontSize, 0) ??
      content.length * style.fontSize * 0.55
    const ascent =
      canvasTextMetrics.baselineFromTop(style.fontFamily, style.fontWeight, style.fontSize) ??
      style.fontSize * 0.85
    return layoutOcrReplacement({
      original: result.glyphDisplayBox,
      baselineFromTop: estimates.baselineFromTop,
      fontSize: style.fontSize,
      replacementWidth: width,
      ascentFromTop: ascent,
      alignment: style.alignment,
      neighbors,
      page: { width: result.baseTransform.cssWidth, height: result.baseTransform.cssHeight },
      overflow,
    })
  }, [result, estimates, style, replacementText, neighbors, overflow])

  const geometry = useMemo(() => {
    if (!result || !layout) {
      return null
    }
    const textBoundsPdf = screenRectToPdfRect(result.baseTransform, layout.textBox)
    const coverBoundsPdf = screenRectToPdfRect(result.baseTransform, layout.coverBox)
    const maskBoundsPdf =
      result.method === 'flat-box' ? coverBoundsPdf : (result.patch?.boundsPdf ?? coverBoundsPdf)
    return { textBoundsPdf, coverBoundsPdf, maskBoundsPdf }
  }, [result, layout])

  const plan = useMemo((): TextReplacementPlan | null => {
    if (!result || !layout || !style || !geometry) {
      return null
    }
    return {
      maskBounds: geometry.maskBoundsPdf,
      textBounds: geometry.textBoundsPdf,
      fontFamily: style.fontFamily,
      fontSize: layout.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      alignment: style.alignment,
      maskFillColor: result.analysis.backgroundColor,
      maskOpacity: 1,
      fidelityStatus: 'ocr_assisted',
      fidelityNotes: [],
    }
  }, [result, layout, style, geometry])

  useEffect(() => {
    if (!plan || !result) {
      setPendingTextReplacement(null)
      return
    }
    setPendingTextReplacement({
      pageIndex: item.pageIndex,
      originalText: scanText,
      replacementText,
      plan,
      backgroundPatch:
        result.method !== 'flat-box' && result.patch
          ? { url: result.patch.url, bounds: result.patch.boundsPdf }
          : null,
    })
  }, [plan, result, item.pageIndex, scanText, replacementText, setPendingTextReplacement])

  const previewText = useMemo((): OcrPreviewText | null => {
    if (!layout || !style) {
      return null
    }
    return {
      content: replacementText.trim(),
      displayBox: layout.textBox,
      fontFamily: style.fontFamily,
      fontSize: layout.fontSize,
      fontWeight: style.fontWeight,
      color: style.color,
      alignment: style.alignment,
      letterSpacing: 0,
    }
  }, [layout, style, replacementText])

  const flatCover = useMemo(
    () =>
      result && layout && result.method === 'flat-box'
        ? { displayBox: layout.coverBox, color: result.analysis.backgroundColor }
        : null,
    [result, layout],
  )

  const lowConfidence = ocrConfidenceTier(item.confidence) === 'low'
  const noGlyphs = Boolean(result && result.method !== 'flat-box' && !result.patch)
  const seamRisk = Boolean(result?.repair && result.repair.seamScore > SEAM_WARNING_SCORE)
  const risks = [
    layout && layout.overlaps.length > 0 ? 'the new text overlaps nearby text' : null,
    layout?.offPage ? 'the new text runs off the page' : null,
    result?.analysis.kind === 'complex' ? 'the background is complex' : null,
    result?.analysis.kind === 'textured' && result.method !== 'flat-box' ? 'the background is textured' : null,
    result?.method === 'flat-box' && result.analysis.kind !== 'solid' ? 'a flat box will not match this background' : null,
    seamRisk ? 'repair seams may be visible' : null,
    lowConfidence ? 'OCR confidence is low' : null,
  ].filter((risk): risk is string => Boolean(risk))
  const needsValueConfirm =
    item.tags.includes('price') || item.tags.includes('quantity') || priceMatchCount > 1

  const canApply =
    Boolean(result && plan && geometry) &&
    repairState.status === 'ready' &&
    replacementText.trim().length > 0 &&
    !noGlyphs &&
    (!needsValueConfirm || confirmedValue) &&
    (risks.length === 0 || acceptedRisks)

  const handleApply = (): void => {
    if (!result || !plan || !geometry || !style || !layout) {
      return
    }
    const method = result.method
    const patch = method !== 'flat-box' ? result.patch : null
    const assetId = patch
      ? registerGeneratedImageAsset({
          bytes: patch.bytes,
          mimeType: 'image/png',
          pixelWidth: patch.pixelWidth,
          pixelHeight: patch.pixelHeight,
        })
      : null
    setCorrectedText(item.id, scanText)
    applyOverlayTextCorrection({
      pageIndex: item.pageIndex,
      bounds: geometry.textBoundsPdf,
      maskBounds: geometry.maskBoundsPdf,
      originalText: scanText,
      replacementText: replacementText.trim(),
      fontSizeHint: layout.fontSize,
      fontFamily: style.fontFamily,
      color: style.color,
      alignment: style.alignment,
      fontWeight: style.fontWeight,
      maskFillColor: result.analysis.backgroundColor,
      maskOpacity: 1,
      ...(assetId && method !== 'flat-box'
        ? {
            maskBackgroundPatch: {
              assetId,
              method,
              backgroundKind: result.analysis.kind,
            },
          }
        : {}),
      ocrEdit: {
        recognizedText: item.text,
        confidence: item.confidence,
        backgroundKind: result.analysis.kind,
        repairMethod: method,
      },
      editSource: 'ocr',
    })
    setPendingTextReplacement(null)
    onClose()
  }

  const handleCancel = (): void => {
    setPendingTextReplacement(null)
    onClose()
  }

  const autoMethod = result && choice === 'auto' && result.method !== 'flat-box' ? result.method : null
  const dpi = result ? Math.round(result.pixelsPerPoint * 72) : null
  const notes = [...(result?.analysis.warnings ?? []), ...(result?.repair?.notes ?? [])]

  return (
    <Modal
      title="Edit scanned text (OCR-assisted)"
      open={open}
      onCancel={handleCancel}
      width={760}
      destroyOnHidden
      footer={
        <Space wrap>
          <Tooltip title="Discards the preview. Nothing on the page changes.">
            <Button onClick={handleCancel}>Cancel</Button>
          </Tooltip>
          <Tooltip title="Adds a background patch and a text overlay. The original scan stays underneath. Undo with Ctrl+Z.">
            <Button type="primary" onClick={handleApply} disabled={!canApply}>
              Apply edit
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Space size={4} wrap style={{ marginBottom: 8 }}>
        <Tag color="warning">OCR estimate</Tag>
        <Tag color={lowConfidence ? 'warning' : 'default'}>{ocrConfidenceLabel(item.confidence)}</Tag>
        {result ? (
          <Tag color={result.analysis.kind === 'complex' ? 'error' : result.analysis.kind === 'solid' ? 'success' : 'processing'}>
            {KIND_LABELS[result.analysis.kind]}
          </Tag>
        ) : null}
        {result ? <Tag>Repair: {METHOD_LABELS[result.method]}</Tag> : null}
        {dpi ? <Tag>{dpi} dpi patch</Tag> : null}
      </Space>

      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        Only this region changes. The original page stays as the base layer; the edit adds a
        small repaired-background image and the new text on top. Font, size and colour are
        estimated from the scan and can be adjusted below.
      </Paragraph>

      {pageContent?.lowResolution ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Low-resolution scan"
          description="OCR boxes and colours are less precise below ~150 dpi. The repair patch is kept at the scan's own resolution, so it may look as soft as the scan."
        />
      ) : null}

      <Form layout="vertical" size="small">
        <Form.Item
          label="What the scan says"
          extra={`Recognized as “${item.text}”. Fix OCR mistakes here — it is used to match the font.`}
        >
          <Input
            value={scanText}
            onChange={(event) => setScanText(event.target.value)}
            aria-label="Text as it appears in the scan"
          />
        </Form.Item>
        <Form.Item label="Replace with">
          <Input
            value={replacementText}
            onChange={(event) => setReplacementText(event.target.value)}
            aria-label="Replacement text"
          />
        </Form.Item>

        <Spin spinning={repairState.status === 'working'} tip="Analysing region…">
          {result ? (
            <OcrRepairPreview
              result={result}
              text={previewText}
              flatCover={flatCover}
              showRepairMask={showRepairMask}
            />
          ) : (
            <div style={{ minHeight: 120 }} />
          )}
        </Spin>
        {repairState.status === 'error' ? (
          <Alert type="error" showIcon message={repairState.error} style={{ marginBottom: 12 }} />
        ) : null}
        <Space style={{ marginBottom: 12 }}>
          <Switch size="small" checked={showRepairMask} onChange={setShowRepairMask} />
          <Text style={{ fontSize: 12 }}>Highlight repaired pixels</Text>
        </Space>

        <Form.Item
          label="Background repair"
          extra={
            autoMethod
              ? `Auto picked ${METHOD_LABELS[autoMethod]} for this ${KIND_LABELS[result!.analysis.kind].toLowerCase()}.`
              : 'Rebuilds only the pixels of the old glyphs; everything else is left untouched.'
          }
        >
          <Segmented
            block
            value={choice}
            onChange={(value) => setChoice(value as BackgroundRepairChoice)}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'solid', label: 'Solid' },
              { value: 'gradient', label: 'Gradient' },
              { value: 'inpaint', label: 'Inpaint' },
              { value: 'flat-box', label: 'Flat box' },
            ]}
          />
        </Form.Item>
        {noGlyphs ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="No text pixels found in the box"
            description="Move or resize the target box so it covers the original text, or choose Flat box."
          />
        ) : null}
        {notes.length > 0 ? (
          <ul style={{ marginTop: 0, paddingLeft: 18 }}>
            {notes.map((note) => (
              <li key={note}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {note}
                </Text>
              </li>
            ))}
          </ul>
        ) : null}

        {estimates && style ? (
          <>
            <Form.Item
              label="Font"
              extra={
                estimates.shapes.length > 0
                  ? 'Installed fonts ranked by how well their glyphs overlap the scanned glyphs at the same height. The original font cannot be recovered from pixels.'
                  : 'The scanned glyphs are too small or faint to compare shapes; fonts are ranked by width only.'
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                value={`${style.fontFamily}|${style.fontWeight}`}
                onChange={selectFont}
                options={fontOptions}
              />
            </Form.Item>
            <Space wrap align="start">
              <Form.Item
                label="Size (pt)"
                extra={
                  Math.abs(estimates.fontSize - estimates.ocrFontSize) > 0.05
                    ? `Cap height match ${estimates.fontSize.toFixed(1)} pt (OCR box ${estimates.ocrFontSize.toFixed(1)} pt)`
                    : `Estimated ${estimates.fontSize.toFixed(1)} pt`
                }
              >
                <InputNumber
                  min={3}
                  max={120}
                  step={0.5}
                  value={Math.round(style.fontSize * 10) / 10}
                  onChange={(value) =>
                    setOverrides((prev) => ({ ...prev, fontSize: Number(value ?? estimates.fontSize) }))
                  }
                />
              </Form.Item>
              <Form.Item label="Weight" extra={estimates.weight.note} style={{ maxWidth: 220 }}>
                <Select
                  value={style.fontWeight}
                  onChange={(value) => setOverrides((prev) => ({ ...prev, fontWeight: value }))}
                  options={[
                    { value: 'normal', label: 'Normal' },
                    { value: 'bold', label: 'Bold' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="Colour" extra="Sampled from the glyph pixels">
                <Input
                  type="color"
                  value={normalizeHexForColorInput(style.color, '#0f172a')}
                  onChange={(event) => setOverrides((prev) => ({ ...prev, color: event.target.value }))}
                  aria-label="Replacement text colour"
                  style={{ width: 64 }}
                />
              </Form.Item>
            </Space>
            <Form.Item label="Alignment" extra={overrides.alignment ? undefined : estimates.alignment.evidence}>
              <Segmented
                value={style.alignment}
                onChange={(value) => setOverrides((prev) => ({ ...prev, alignment: value as TextAlignment }))}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Centre' },
                  { value: 'right', label: 'Right' },
                ]}
              />
            </Form.Item>
            <Form.Item label="If the new text is longer than the original">
              <Radio.Group value={overflow} onChange={(event) => setOverflow(event.target.value as OverflowPolicy)}>
                <Radio value="extend">Keep the size and extend</Radio>
                <Radio value="fit">Shrink uniformly to fit</Radio>
              </Radio.Group>
            </Form.Item>
            {layout && layout.warnings.length > 0 ? (
              <Alert
                type={layout.overlaps.length > 0 || layout.offPage ? 'error' : 'warning'}
                showIcon
                style={{ marginBottom: 12 }}
                message="Layout"
                description={layout.warnings.join(' ')}
              />
            ) : null}
          </>
        ) : null}

        <Text strong style={{ fontSize: 12, display: 'block' }}>
          Target box around the original text (PDF points)
        </Text>
        <Space wrap style={{ marginTop: 8, marginBottom: 8 }}>
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <Form.Item key={key} label={key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? 'Width' : 'Height'} style={{ marginBottom: 0 }}>
              <InputNumber
                min={key === 'width' || key === 'height' ? 2 : undefined}
                step={0.5}
                value={Math.round(bounds[key] * 10) / 10}
                onChange={(value) => setBounds((prev) => ({ ...prev, [key]: Number(value ?? prev[key]) }))}
              />
            </Form.Item>
          ))}
          <Button size="small" onClick={() => setBounds(item.bounds)} style={{ marginTop: 22 }}>
            Reset to OCR box
          </Button>
        </Space>

        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {canUndo
            ? 'After applying, Undo (Ctrl+Z) removes the last committed edit.'
            : 'Applied edits can be undone with Ctrl+Z.'}
        </Text>
      </Form>

      {needsValueConfirm ? (
        <Checkbox
          checked={confirmedValue}
          onChange={(event) => setConfirmedValue(event.target.checked)}
          style={{ marginTop: 12, display: 'flex' }}
        >
          I confirm this is the exact value I want to change on the page.
        </Checkbox>
      ) : null}
      {risks.length > 0 ? (
        <Checkbox
          checked={acceptedRisks}
          onChange={(event) => setAcceptedRisks(event.target.checked)}
          style={{ marginTop: 8, display: 'flex' }}
        >
          I compared the preview with the original and accept that {risks.join(', ')}.
        </Checkbox>
      ) : null}
    </Modal>
  )
}
