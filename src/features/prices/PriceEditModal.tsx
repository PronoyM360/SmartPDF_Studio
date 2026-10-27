import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorPreview, type WorkspacePreviewMode } from '@/features/pdf-editor/EditorPreviewContext'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { TEXT_FONT_FAMILIES } from '@/features/text-tools/textDefaults'
import { TextReplacementPreview } from '@/features/text-tools/TextReplacementPreview'
import { ocrConfidenceLabel } from '@/lib/ocr/ocrConfidence'
import { fidelityStatusLabel } from '@/lib/pdf/buildTextReplacementPlan'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import { describeAmount, parseAmount, resolveReplacementInput } from '@/lib/prices/amountFormat'
import {
  buildPriceReplacementPlan,
  type PricePlanResult,
  type PriceStyleChoice,
} from '@/lib/prices/buildPriceReplacementPlan'
import { amountValueKey, substringSpan } from '@/lib/prices/detectPriceCandidates'
import { PRICE_ROLE_COLORS, PRICE_ROLE_LABELS } from '@/lib/prices/priceLabels'
import { checkEditedRelationships, relatedAmountsOnPage } from '@/lib/prices/priceRelationships'
import type { PriceAlignment, PriceCandidate } from '@/types/priceEditing'
import { canvasTextMetrics } from './canvasTextMetrics'
import { usePriceEditor, type AmountEditRequest } from './PriceEditorContext'
import { resolvePriceStyle, type EvidenceLevel, type PriceStyleEvidence } from './resolvePriceStyle'
import styles from './PriceEditModal.module.css'

const { Text, Paragraph } = Typography

const LEVEL_TAG: Record<EvidenceLevel, { color: string; label: string }> = {
  exact: { color: 'success', label: 'From PDF' },
  measured: { color: 'processing', label: 'Measured' },
  approximate: { color: 'warning', label: 'Approximate' },
  unavailable: { color: 'default', label: 'Unavailable' },
}

type StyleOverrides = Partial<
  Pick<PriceStyleChoice, 'fontFamily' | 'fontWeight' | 'fontSizePt' | 'color' | 'maskFillColor' | 'alignment'>
>

/** The digits part of a printed amount, used to prefill the input ("BDT 5,784.00" → "5,784.00"). */
function numberPart(text: string): string {
  return /\d(?:[\d,.'\u00a0\u202f ]*\d)?/.exec(text)?.[0] ?? text
}

export function PriceEditModal() {
  const {
    editingId,
    closeEditor,
    candidates,
    relationships,
    committedEdits,
    committedValues,
    getRun,
    getFont,
    getContentColor,
    getNeighborRuns,
    getRunMeasurer,
    applyAmountEdits,
  } = usePriceEditor()
  const { getPageMeta } = usePdfViewer()
  const { previewMode, setPreviewMode, setPendingTextReplacement } = useEditorPreview()

  const candidate = useMemo(
    () => candidates.find((entry) => entry.id === editingId) ?? null,
    [candidates, editingId],
  )
  const open = candidate !== null

  const [originalText, setOriginalText] = useState('')
  const [input, setInput] = useState('')
  const [matchFormat, setMatchFormat] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [includeIds, setIncludeIds] = useState<ReadonlySet<string>>(new Set())
  const [overrides, setOverrides] = useState<StyleOverrides>({})
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [evidenceNonce, setEvidenceNonce] = useState(0)
  const [evidence, setEvidence] = useState<PriceStyleEvidence | null>(null)
  const previousModeRef = useRef<WorkspacePreviewMode | null>(null)

  useEffect(() => {
    if (!candidate) {
      return
    }
    const existing = committedEdits.get(candidate.id)
    setOriginalText(candidate.text)
    setInput(numberPart(existing?.content ?? candidate.text))
    setMatchFormat(true)
    setConfirmed(false)
    setIncludeIds(new Set())
    setOverrides({})
    setEvidence(null)
    setPageSize(null)
    void getPageMeta(candidate.pageIndex).then((meta) => setPageSize({ width: meta.width, height: meta.height }))
    // Keep the original visible next to the edit while reviewing.
    previousModeRef.current = previousModeRef.current ?? previewMode
    setPreviewMode('side-by-side')
    // Re-initialise only when a different amount is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id])

  const evidenceFor = useCallback(
    (target: PriceCandidate, text: string): PriceStyleEvidence | null => {
      if (!pageSize) {
        return null
      }
      return resolvePriceStyle({
        candidate: target,
        run: getRun(target),
        pageCandidates: candidates.filter((entry) => entry.pageIndex === target.pageIndex),
        font: getFont(target),
        contentColor: getContentColor(target),
        pageWidthPt: pageSize.width,
        pageHeightPt: pageSize.height,
        originalText: text,
      })
    },
    [pageSize, getRun, getFont, getContentColor, candidates],
  )

  useEffect(() => {
    if (!candidate || !pageSize) {
      return
    }
    // Opening the editor switches to side-by-side, which re-renders the page canvas;
    // retry while the glyphs are not painted yet.
    let attempt = 0
    let timer = 0
    const measure = (): void => {
      const result = evidenceFor(candidate, candidate.text)
      setEvidence(result)
      attempt += 1
      if (result && result.fontScores.length === 0 && attempt < 5) {
        timer = window.setTimeout(measure, 400 * attempt)
      }
    }
    timer = window.setTimeout(measure, 250)
    return () => window.clearTimeout(timer)
  }, [candidate, pageSize, evidenceFor, evidenceNonce])

  const template = useMemo(
    () => (candidate ? (parseAmount(originalText) ?? candidate.amount) : null),
    [candidate, originalText],
  )
  const resolution = useMemo(
    () => (template ? resolveReplacementInput(template, input, matchFormat) : null),
    [template, input, matchFormat],
  )

  const style = useMemo<PriceStyleChoice | null>(
    () => (evidence ? { ...evidence.style, ...overrides } : null),
    [evidence, overrides],
  )

  const neighborsFor = useCallback(
    (target: PriceCandidate) => {
      const run = getRun(target)
      const neighbors = getNeighborRuns(target).map((entry) => ({ text: entry.text, bounds: entry.bounds }))
      if (run) {
        // Rest of the same run (e.g. the "Gross Fare:" label), measured like the amount itself.
        const measure = getRunMeasurer(target.pageIndex)
        const before = run.text.slice(0, target.startIndex)
        const after = run.text.slice(target.endIndex)
        const parts: [number, number][] = [
          [before.length - before.trimStart().length, before.trimEnd().length],
          [target.endIndex + (after.length - after.trimStart().length), target.endIndex + after.trimEnd().length],
        ]
        for (const [start, end] of parts) {
          if (end > start) {
            const span = substringSpan(run, start, end, measure)
            neighbors.push({
              text: run.text.slice(start, end),
              bounds: { x: span.x, y: run.bounds.y, width: span.width, height: run.bounds.height },
            })
          }
        }
      }
      return neighbors
    },
    [getRun, getNeighborRuns, getRunMeasurer],
  )

  const planResult = useMemo<PricePlanResult | null>(() => {
    if (!candidate || !style || !evidence || !resolution || resolution.error) {
      return null
    }
    const userChangedFont = overrides.fontFamily !== undefined && overrides.fontFamily !== evidence.style.fontFamily
    return buildPriceReplacementPlan({
      candidate,
      replacementText: resolution.text,
      style,
      fidelityStatus: userChangedFont && evidence.fidelityStatus === 'original_style_matched' ? 'approximate_font_match' : evidence.fidelityStatus,
      fidelityNotes: evidence.notes,
      neighbors: neighborsFor(candidate),
      metrics: canvasTextMetrics,
    })
  }, [candidate, style, evidence, resolution, overrides.fontFamily, neighborsFor])

  useEffect(() => {
    if (!open || !candidate || !planResult || !resolution) {
      setPendingTextReplacement(null)
      return
    }
    setPendingTextReplacement({
      pageIndex: candidate.pageIndex,
      originalText,
      replacementText: resolution.text,
      plan: planResult.plan,
    })
  }, [open, candidate, planResult, resolution, originalText, setPendingTextReplacement])

  const duplicates = useMemo(
    () =>
      candidate
        ? candidates.filter(
            (entry) =>
              entry.id !== candidate.id &&
              entry.editable &&
              amountValueKey(entry.amount.value) === amountValueKey(candidate.amount.value),
          )
        : [],
    [candidates, candidate],
  )

  const draftValues = useMemo(() => {
    const values = new Map(committedValues)
    if (candidate && resolution?.value !== null && resolution?.value !== undefined) {
      values.set(candidate.id, resolution.value)
      for (const id of includeIds) {
        values.set(id, resolution.value)
      }
    }
    return values
  }, [committedValues, candidate, resolution, includeIds])

  const touched = useMemo(() => new Set([candidate?.id, ...includeIds]), [candidate, includeIds])
  const relationshipWarnings = useMemo(
    () =>
      checkEditedRelationships({ candidates, relationships, editedValues: draftValues }).filter((warning) =>
        warning.relatedCandidateIds.some((id) => touched.has(id)),
      ),
    [candidates, relationships, draftValues, touched],
  )
  const linked = useMemo(
    () =>
      candidate
        ? relationships.some(
            (entry) => entry.targetId === candidate.id || entry.terms.some((term) => term.candidateId === candidate.id),
          )
        : false,
    [relationships, candidate],
  )
  const related = useMemo(
    () => (candidate ? relatedAmountsOnPage(candidates, candidate) : []),
    [candidates, candidate],
  )

  const handleClose = useCallback(() => {
    setPendingTextReplacement(null)
    if (previousModeRef.current) {
      setPreviewMode(previousModeRef.current)
      previousModeRef.current = null
    }
    closeEditor()
  }, [closeEditor, setPendingTextReplacement, setPreviewMode])

  if (!candidate || !template || !resolution) {
    return null
  }

  const isOcr = candidate.source === 'ocr'
  const needsConfirmation = isOcr || candidate.confidence === 'low'
  const existing = committedEdits.get(candidate.id)
  const unchanged = resolution.text.trim() === (existing?.content ?? candidate.text).trim()
  const canApply =
    Boolean(planResult) && !resolution.error && !unchanged && (!needsConfirmation || confirmed)

  const handleApply = (): void => {
    if (!planResult || !evidence || !style) {
      return
    }
    const requests: AmountEditRequest[] = [
      {
        candidate,
        originalText,
        replacementText: resolution.text,
        replacementValue: resolution.value,
        plan: planResult.plan,
        evidence,
      },
    ]
    for (const id of includeIds) {
      const other = candidates.find((entry) => entry.id === id)
      const otherEvidence = other ? evidenceFor(other, other.text) : null
      if (!other || !otherEvidence) {
        continue
      }
      const otherResolution = resolveReplacementInput(other.amount, input, matchFormat)
      if (otherResolution.error) {
        continue
      }
      const otherPlan = buildPriceReplacementPlan({
        candidate: other,
        replacementText: otherResolution.text,
        style: otherEvidence.style,
        fidelityStatus: otherEvidence.fidelityStatus,
        fidelityNotes: otherEvidence.notes,
        neighbors: neighborsFor(other),
        metrics: canvasTextMetrics,
      })
      requests.push({
        candidate: other,
        originalText: other.text,
        replacementText: otherResolution.text,
        replacementValue: otherResolution.value,
        plan: otherPlan.plan,
        evidence: otherEvidence,
      })
    }
    applyAmountEdits(requests)
    handleClose()
  }

  const fontOptions = [
    ...(evidence
      ? [
          {
            value: evidence.style.fontFamily,
            label:
              evidence.fontMatch === 'embedded_verified'
                ? 'Original embedded font (verified)'
                : `${evidence.fallbackFontFamily} (closest match)`,
          },
        ]
      : []),
    ...TEXT_FONT_FAMILIES.filter((family) => family !== evidence?.style.fontFamily).map((family) => ({
      value: family,
      label: family,
    })),
  ]
  const fontLabel = evidence
    ? evidence.fontMatch === 'embedded_verified' && overrides.fontFamily === undefined
      ? { color: 'success', text: 'Original embedded font (verified against page)' }
      : { color: 'warning', text: 'Approximate font match' }
    : null

  return (
    <Modal
      title={`Edit amount — ${candidate.label ?? PRICE_ROLE_LABELS[candidate.role]}`}
      open={open}
      onCancel={handleClose}
      width={680}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={handleClose}>Cancel</Button>
          <Tooltip title="Adds a cover and the new value as overlays. The original PDF stays unchanged; Undo (Ctrl+Z) reverts.">
            <Button type="primary" disabled={!canApply} onClick={handleApply}>
              Apply{includeIds.size > 0 ? ` to ${includeIds.size + 1} amounts` : ''}
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Space size={4} wrap className={styles.tags}>
        <Tag color={PRICE_ROLE_COLORS[candidate.role]}>{PRICE_ROLE_LABELS[candidate.role]}</Tag>
        <Tag>Page {candidate.pageIndex + 1}</Tag>
        {isOcr ? <Tag color="purple">{ocrConfidenceLabel(candidate.ocrConfidence ?? 0)}</Tag> : <Tag color="blue">Selectable PDF text</Tag>}
        {fontLabel ? <Tag color={fontLabel.color}>{fontLabel.text}</Tag> : null}
        {planResult && fidelityStatusLabel(planResult.plan.fidelityStatus) !== fontLabel?.text ? (
          <Tag>{fidelityStatusLabel(planResult.plan.fidelityStatus)}</Tag>
        ) : null}
      </Space>

      <Alert
        type="info"
        showIcon
        className={styles.alert}
        message="For authorized corrections and clearly identified edited copies"
        description="The export is labelled as a modified copy. Do not present it as an original or verified document."
      />

      {isOcr ? (
        <Alert
          type="warning"
          showIcon
          className={styles.alert}
          message="Amount inside an image — OCR estimate"
          description="Check the recognised value and its position. The background and font are reconstructed approximately and may not match the scan."
        />
      ) : null}

      <Form layout="vertical" size="small">
        <div className={styles.originalRow}>
          <Form.Item
            label={isOcr ? 'Recognised value (correct OCR mistakes)' : 'Original value'}
            className={styles.grow}
          >
            <Input
              value={originalText}
              readOnly={!isOcr}
              onChange={(event) => setOriginalText(event.target.value)}
              aria-label="Original value"
            />
          </Form.Item>
          <Form.Item label="Label">
            <Text>{candidate.label ?? '—'}</Text>
          </Form.Item>
        </div>
        <Paragraph type="secondary" className={styles.context}>
          In context: “{candidate.runText}”
        </Paragraph>

        <Form.Item
          label="New value"
          validateStatus={resolution.error ? 'error' : undefined}
          help={resolution.error ?? undefined}
          extra={
            <Space size={6}>
              <Switch size="small" checked={matchFormat} onChange={setMatchFormat} aria-label="Match original format" />
              <Text type="secondary" className={styles.small}>
                Match original format (currency, separators, decimals)
              </Text>
            </Space>
          }
        >
          <Input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={() => (canApply ? handleApply() : undefined)}
            aria-label="Replacement value"
          />
        </Form.Item>

        <div className={styles.beforeAfter}>
          <Text type="secondary">Before</Text>
          <Text strong className={styles.amount}>{candidate.text}</Text>
          <Text type="secondary">After</Text>
          <Text strong className={styles.amount}>{resolution.text || '…'}</Text>
        </div>
        {resolution.notes.map((note) => (
          <Text key={note} type="secondary" className={styles.small}>
            {note}
          </Text>
        ))}
        {unchanged && !resolution.error ? (
          <Text type="secondary" className={styles.small}>
            The new value is the same as the current one.
          </Text>
        ) : null}

        {planResult?.warnings.map((warning) => (
          <Alert key={warning} type="warning" showIcon className={styles.alert} message={warning} />
        ))}
        {style?.backgroundKind === 'complex' ? (
          <Alert
            type="error"
            showIcon
            className={styles.alert}
            message="The background cannot be reconstructed reliably"
            description="A flat cover will be visible on patterned, photographic or gradient backgrounds. Compare in the side-by-side view before applying."
          />
        ) : null}

        {relationshipWarnings.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            className={styles.alert}
            message="Related amounts may no longer match"
            description={
              <ul className={styles.list}>
                {relationshipWarnings.map((warning) => (
                  <li key={warning.relationshipId}>{warning.message}</li>
                ))}
              </ul>
            }
          />
        ) : !linked && related.length > 0 ? (
          <Alert
            type="info"
            showIcon
            className={styles.alert}
            message="No arithmetic link found for this amount"
            description={`Other amounts on this page were not changed or checked against it: ${related
              .slice(0, 6)
              .map((entry) => `${entry.label ?? PRICE_ROLE_LABELS[entry.role]} ${describeAmount(entry.amount, committedValues.get(entry.id) ?? entry.amount.value)}`)
              .join(', ')}. Review them if they depend on this value.`}
          />
        ) : null}

        {duplicates.length > 0 ? (
          <div className={styles.duplicates}>
            <Text strong className={styles.small}>
              The same value appears {duplicates.length} more time{duplicates.length === 1 ? '' : 's'}. Only this one
              changes unless you tick others below.
            </Text>
            {duplicates.map((entry) => (
              <Checkbox
                key={entry.id}
                checked={includeIds.has(entry.id)}
                onChange={(event) =>
                  setIncludeIds((prev) => {
                    const next = new Set(prev)
                    if (event.target.checked) {
                      next.add(entry.id)
                    } else {
                      next.delete(entry.id)
                    }
                    return next
                  })
                }
              >
                <Text className={styles.small}>
                  Page {entry.pageIndex + 1} · {entry.label ?? PRICE_ROLE_LABELS[entry.role]} · {entry.text}
                  {entry.source === 'ocr' ? ' (OCR)' : ''}
                </Text>
              </Checkbox>
            ))}
          </div>
        ) : null}

        {style ? (
          <details className={styles.styleBox}>
            <summary>Style (preserved from the original)</summary>
            <Descriptions size="small" column={1} className={styles.evidence}>
              {evidence?.rows.map((row) => (
                <Descriptions.Item
                  key={row.property}
                  label={row.property}
                >
                  <Space size={4} wrap>
                    <Text className={styles.small}>{row.value}</Text>
                    <Tag color={LEVEL_TAG[row.level].color}>{LEVEL_TAG[row.level].label}</Tag>
                  </Space>
                  <Text type="secondary" className={styles.evidenceDetail}>
                    {row.detail}
                  </Text>
                </Descriptions.Item>
              ))}
            </Descriptions>
            <Button size="small" type="link" onClick={() => setEvidenceNonce((value) => value + 1)}>
              Re-check against page
            </Button>
            <div className={styles.controls}>
              <Form.Item label="Font">
                <Select
                  value={style.fontFamily}
                  options={fontOptions}
                  onChange={(value) => setOverrides((prev) => ({ ...prev, fontFamily: value }))}
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
              <Form.Item label="Size (pt)">
                <InputNumber
                  min={4}
                  max={120}
                  step={0.5}
                  value={Math.round(style.fontSizePt * 10) / 10}
                  onChange={(value) => setOverrides((prev) => ({ ...prev, fontSizePt: Number(value ?? style.fontSizePt) }))}
                />
              </Form.Item>
              <Form.Item label="Weight">
                <Select
                  value={style.fontWeight}
                  options={[
                    { value: 'normal', label: 'Regular' },
                    { value: 'bold', label: 'Bold' },
                  ]}
                  onChange={(value) => setOverrides((prev) => ({ ...prev, fontWeight: value }))}
                />
              </Form.Item>
              <Form.Item label="Colour">
                <Input
                  type="color"
                  value={normalizeHexForColorInput(style.color, '#000000')}
                  onChange={(event) => setOverrides((prev) => ({ ...prev, color: event.target.value }))}
                  aria-label="Text colour"
                />
              </Form.Item>
              <Form.Item label="Cover">
                <Input
                  type="color"
                  value={normalizeHexForColorInput(style.maskFillColor, '#ffffff')}
                  onChange={(event) => setOverrides((prev) => ({ ...prev, maskFillColor: event.target.value }))}
                  aria-label="Cover colour"
                />
              </Form.Item>
              <Form.Item label="Anchor">
                <Segmented<PriceAlignment>
                  size="small"
                  value={style.alignment}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Centre' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(value) => setOverrides((prev) => ({ ...prev, alignment: value }))}
                />
              </Form.Item>
            </div>
          </details>
        ) : (
          <Text type="secondary" className={styles.small}>
            Measuring the original style…
          </Text>
        )}

        {style && resolution.text ? (
          <TextReplacementPreview
            replacementText={resolution.text}
            fontFamily={style.fontFamily}
            fontSizePt={style.fontSizePt}
            color={style.color}
            fontWeight={style.fontWeight}
            maskFillColor={style.maskFillColor}
          />
        ) : null}
        <Text type="secondary" className={styles.small}>
          The page shows a dashed cyan preview at the exact position; the left pane keeps the original for
          comparison. After applying, use Undo (Ctrl+Z) or the revert button in the list.
        </Text>

        {needsConfirmation ? (
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className={styles.confirm}>
            {isOcr
              ? 'I checked the recognised value and its position on the page.'
              : 'I confirm this number is the amount I want to change (detection confidence is low).'}
          </Checkbox>
        ) : null}
      </Form>
    </Modal>
  )
}
