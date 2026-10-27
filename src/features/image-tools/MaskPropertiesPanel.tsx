import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, InputNumber, Modal, Segmented, Slider, Space } from 'antd'
import { MASK_MODE_LABELS, maskModeOf } from '@/lib/redaction/maskModes'
import type { MaskMode } from '@/types/maskOverlay'
import { useMemo } from 'react'
import {
  BACKGROUND_PROCESSING_ENGINES,
  getDefaultBackgroundEngine,
} from '@/lib/background/BackgroundProcessingEngine'
import {
  expandPageRect,
  MASK_COLOR_PRESETS,
  shrinkPageRect,
} from '@/lib/background/maskRefinement'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { MaskBeforeAfterPreview } from '@/features/image-tools/MaskBeforeAfterPreview'
import { usePageViewport } from '@/features/text-tools/usePageViewport'
import { createPageDisplayTransform } from '@/lib/pdf'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import type { MaskOverlayObject } from '@/types/maskOverlay'
import styles from './MaskPropertiesPanel.module.css'

interface MaskPropertiesPanelProps {
  object: MaskOverlayObject
  pageNumber: number
  renderScale: number
}

export function MaskPropertiesPanel({
  object,
  pageNumber,
  renderScale,
}: MaskPropertiesPanelProps) {
  const {
    updateMaskObject,
    deleteSelectedObject,
    duplicateSelectedObject,
    setMaskEyedropperActive,
    maskEyedropperActive,
    commitOverlayHistoryStep,
  } = useEditorSession()

  const LIVE = { recordHistory: false } as const
  const commit = (): void => {
    commitOverlayHistoryStep()
  }

  const viewport = usePageViewport(pageNumber, renderScale)
  const pageTransform = useMemo(() => {
    if (!viewport) {
      return null
    }
    return createPageDisplayTransform(object.pageIndex, viewport)
  }, [object.pageIndex, viewport])

  const fillColorInput = normalizeHexForColorInput(object.fillColor, '#ffffff')
  const mode = maskModeOf(object)

  const changeMode = (next: MaskMode): void => {
    if (next === mode) {
      return
    }
    if (next !== 'redact') {
      updateMaskObject(object.id, { mode: next })
      return
    }
    Modal.confirm({
      title: 'Turn this box into a redaction?',
      content:
        'When you download, this page is flattened to an image with the area filled, so the content underneath is removed. Other text on the same page stops being selectable, and links or form fields on that page are removed. You can undo this.',
      okText: 'Make redaction',
      okType: 'danger',
      onOk: () => updateMaskObject(object.id, { mode: 'redact', opacity: 1 }),
    })
  }

  const engine = getDefaultBackgroundEngine()
  const enginePreview = engine.describe({
    pageIndex: object.pageIndex,
    region: object.bounds,
    mask: object,
  })

  return (
    <Form layout="vertical" size="small" className={styles.form}>
      <Form.Item label="What this box does">
        <Segmented
          block
          size="small"
          value={mode}
          options={[
            { value: 'hide', label: 'Hide (preview)' },
            { value: 'cover', label: 'Cover' },
            { value: 'redact', label: 'Redact' },
          ]}
          onChange={(value) => changeMode(value as MaskMode)}
        />
      </Form.Item>
      <Alert
        type={mode === 'cover' ? 'warning' : 'info'}
        showIcon
        message={MASK_MODE_LABELS[mode].short}
        description={MASK_MODE_LABELS[mode].long}
        className={styles.alert}
      />
      {object.label ? (
        <Alert type="info" message={`Applied to: ${object.label}`} className={styles.alert} />
      ) : null}

      <Form.Item label="Background method">
        <Segmented
          block
          value={engine.id}
          options={BACKGROUND_PROCESSING_ENGINES.map((entry) => ({
            value: entry.id,
            label: entry.label,
            disabled: !entry.available,
          }))}
        />
        <Alert
          type="info"
          showIcon
          message="Inpainting not installed"
          description={
            BACKGROUND_PROCESSING_ENGINES.find((entry) => entry.id === 'inpaint')
              ?.availabilityNote
          }
          className={styles.engineNote}
        />
      </Form.Item>

      {enginePreview.warnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="Manual masking limits"
          description={enginePreview.warnings[0]}
          className={styles.alert}
        />
      ) : null}

      <Form.Item label="Fill color">
        <Space wrap className={styles.presets}>
          {MASK_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              style={{ background: color }}
              aria-label={`Preset ${color}`}
              onClick={() => updateMaskObject(object.id, { fillColor: color })}
            />
          ))}
        </Space>
        <Input
          type="color"
          value={fillColorInput}
          onChange={(event) =>
            updateMaskObject(object.id, { fillColor: event.target.value }, LIVE)
          }
          onBlur={commit}
          aria-label="Mask fill color"
        />
        <Input
          size="small"
          value={object.fillColor}
          onChange={(event) =>
            updateMaskObject(object.id, { fillColor: event.target.value }, LIVE)
          }
          onBlur={commit}
          className={styles.hexInput}
          aria-label="Mask color hex"
        />
      </Form.Item>

      <Form.Item
        label={
          mode === 'cover'
            ? `Opacity (${Math.round(object.opacity * 100)}%)`
            : 'Opacity (always 100% for hide and redact)'
        }
      >
        <Slider
          min={0.05}
          max={1}
          step={0.05}
          disabled={mode !== 'cover'}
          value={mode === 'cover' ? object.opacity : 1}
          onChange={(value) =>
            updateMaskObject(object.id, { opacity: Number(value) }, LIVE)
          }
          onChangeComplete={commit}
        />
      </Form.Item>

      <Form.Item label="Sample color from page">
        <Button
          size="small"
          type={maskEyedropperActive ? 'primary' : 'default'}
          onClick={() => setMaskEyedropperActive(!maskEyedropperActive)}
        >
          {maskEyedropperActive ? 'Click page to sample…' : 'Eyedropper'}
        </Button>
      </Form.Item>

      {pageTransform ? (
        <Form.Item label="Before / after preview">
          <MaskBeforeAfterPreview
            pageNumber={pageNumber}
            transform={pageTransform}
            mask={object}
          />
        </Form.Item>
      ) : null}

      <Form.Item label="Refine bounds">
        <Space wrap>
          <Button
            size="small"
            onClick={() =>
              updateMaskObject(object.id, {
                bounds: expandPageRect(object.bounds, 2),
              })
            }
          >
            Expand 2pt
          </Button>
          <Button
            size="small"
            onClick={() =>
              updateMaskObject(object.id, {
                bounds: shrinkPageRect(object.bounds, 2),
              })
            }
          >
            Shrink 2pt
          </Button>
        </Space>
      </Form.Item>

      <Form.Item label="Position X (PDF pt)">
        <InputNumber
          value={Math.round(object.bounds.x * 10) / 10}
          onChange={(value) =>
            updateMaskObject(
              object.id,
              {
                bounds: { ...object.bounds, x: Number(value ?? object.bounds.x) },
              },
              LIVE,
            )
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Form.Item label="Position Y (PDF pt)">
        <InputNumber
          value={Math.round(object.bounds.y * 10) / 10}
          onChange={(value) =>
            updateMaskObject(
              object.id,
              {
                bounds: { ...object.bounds, y: Number(value ?? object.bounds.y) },
              },
              LIVE,
            )
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Form.Item label="Width (PDF pt)">
        <InputNumber
          min={8}
          value={Math.round(object.bounds.width * 10) / 10}
          onChange={(value) =>
            updateMaskObject(
              object.id,
              {
                bounds: {
                  ...object.bounds,
                  width: Number(value ?? object.bounds.width),
                },
              },
              LIVE,
            )
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Form.Item label="Height (PDF pt)">
        <InputNumber
          min={8}
          value={Math.round(object.bounds.height * 10) / 10}
          onChange={(value) =>
            updateMaskObject(
              object.id,
              {
                bounds: {
                  ...object.bounds,
                  height: Number(value ?? object.bounds.height),
                },
              },
              LIVE,
            )
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Space wrap>
        <Button size="small" icon={<CopyOutlined />} onClick={duplicateSelectedObject}>
          Duplicate
        </Button>
        <Button size="small" danger icon={<DeleteOutlined />} onClick={deleteSelectedObject}>
          Delete
        </Button>
      </Space>
    </Form>
  )
}
