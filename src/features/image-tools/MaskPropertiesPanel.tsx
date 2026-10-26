import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, InputNumber, Segmented, Slider, Space } from 'antd'
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

  const engine = getDefaultBackgroundEngine()
  const enginePreview = engine.describe({
    pageIndex: object.pageIndex,
    region: object.bounds,
    mask: object,
  })

  return (
    <Form layout="vertical" size="small" className={styles.form}>
      <Alert
        type="warning"
        showIcon
        message="Visual cover only"
        description="Masks hide content in the editor preview and export drawing. They do not securely erase PDF data."
        className={styles.alert}
      />

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

      <Form.Item label={`Opacity (${Math.round(object.opacity * 100)}%)`}>
        <Slider
          min={0.05}
          max={1}
          step={0.05}
          value={object.opacity}
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
