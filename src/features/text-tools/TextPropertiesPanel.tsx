import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Button, Form, Input, InputNumber, Select, Slider, Space } from 'antd'
import { useMemo } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { buildTextFontFamilyOptions } from '@/features/text-tools/buildTextFontFamilyOptions'
import {
  MIN_TEXT_BOX_HEIGHT_PT,
  MIN_TEXT_BOX_WIDTH_PT,
} from '@/features/text-tools/textDefaults'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import type { TextAlignment, TextOverlayObject } from '@/types/textOverlay'
import styles from './TextPropertiesPanel.module.css'

const LIVE = { recordHistory: false } as const

interface TextPropertiesPanelProps {
  object: TextOverlayObject
}

export function TextPropertiesPanel({ object: selected }: TextPropertiesPanelProps) {
  const {
    updateTextObject,
    deleteSelectedObject,
    duplicateSelectedObject,
    commitOverlayHistoryStep,
  } = useEditorSession()

  const commit = (): void => {
    commitOverlayHistoryStep()
  }

  const fontOptions = useMemo(
    () =>
      buildTextFontFamilyOptions({
        selectedFamily: selected.fontFamily,
      }),
    [selected.fontFamily],
  )

  const hasBackground = Boolean(selected.backgroundColor)
  const backgroundPickerValue = normalizeHexForColorInput(
    selected.backgroundColor ?? '#ffffff',
    '#ffffff',
  )

  return (
    <Form layout="vertical" size="small" className={styles.form}>
      <Form.Item label="Text content (overlay — not native PDF text)">
        <Input.TextArea
          rows={3}
          value={selected.content}
          onChange={(event) =>
            updateTextObject(selected.id, { content: event.target.value }, LIVE)
          }
          onBlur={commit}
        />
      </Form.Item>
      <Form.Item
        label="Font family"
        extra="Type a custom name if your PDF font is installed on this device."
      >
        <Select
          showSearch
          optionFilterProp="label"
          value={selected.fontFamily}
          options={fontOptions}
          onChange={(value) => {
            updateTextObject(selected.id, { fontFamily: value })
          }}
        />
      </Form.Item>
      <Form.Item label="Font weight">
        <Select
          value={selected.fontWeight ?? 'normal'}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'bold', label: 'Bold' },
          ]}
          onChange={(value) =>
            updateTextObject(selected.id, {
              fontWeight: value as TextOverlayObject['fontWeight'],
            })
          }
        />
      </Form.Item>
      <Form.Item label="Font size (pt)">
        <InputNumber
          min={6}
          max={120}
          value={selected.fontSize}
          onChange={(value) =>
            updateTextObject(
              selected.id,
              { fontSize: Number(value ?? selected.fontSize) },
              LIVE,
            )
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Form.Item label="Text color">
        <Input
          type="color"
          value={normalizeHexForColorInput(selected.color, '#0f172a')}
          onChange={(event) =>
            updateTextObject(selected.id, { color: event.target.value }, LIVE)
          }
          onBlur={commit}
          aria-label="Text color"
        />
      </Form.Item>
      <Form.Item
        label="Background color"
        extra="Fill behind the text in the box. Use Transparent when you only want text on the page."
      >
        <Space wrap align="center">
          <Input
            type="color"
            value={backgroundPickerValue}
            disabled={!hasBackground}
            onChange={(event) =>
              updateTextObject(
                selected.id,
                {
                  backgroundColor: event.target.value,
                  backgroundOpacity: selected.backgroundOpacity ?? 1,
                },
                LIVE,
              )
            }
            onBlur={commit}
            aria-label="Text box background color"
          />
          <Input
            size="small"
            value={selected.backgroundColor ?? ''}
            placeholder="Transparent"
            onChange={(event) => {
              const value = event.target.value.trim()
              if (!value) {
                updateTextObject(
                  selected.id,
                  { backgroundColor: undefined, backgroundOpacity: undefined },
                  LIVE,
                )
                return
              }
              updateTextObject(
                selected.id,
                {
                  backgroundColor: value,
                  backgroundOpacity: selected.backgroundOpacity ?? 1,
                },
                LIVE,
              )
            }}
            onBlur={commit}
            className={styles.hexInput}
            aria-label="Background color hex"
          />
          <Button
            size="small"
            type={hasBackground ? 'default' : 'primary'}
            onClick={() => {
              if (hasBackground) {
                updateTextObject(selected.id, {
                  backgroundColor: undefined,
                  backgroundOpacity: undefined,
                })
              } else {
                updateTextObject(selected.id, {
                  backgroundColor: '#ffffff',
                  backgroundOpacity: 1,
                })
              }
            }}
          >
            {hasBackground ? 'Transparent' : 'Add background'}
          </Button>
        </Space>
      </Form.Item>
      {hasBackground ? (
        <Form.Item
          label={`Background opacity (${Math.round((selected.backgroundOpacity ?? 1) * 100)}%)`}
        >
          <Slider
            min={0.05}
            max={1}
            step={0.05}
            value={selected.backgroundOpacity ?? 1}
            onChange={(value) =>
              updateTextObject(
                selected.id,
                { backgroundOpacity: Number(value) },
                LIVE,
              )
            }
            onChangeComplete={commit}
          />
        </Form.Item>
      ) : null}
      <Form.Item label="Alignment">
        <Select<TextAlignment>
          value={selected.alignment}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(value) => updateTextObject(selected.id, { alignment: value })}
        />
      </Form.Item>
      <Form.Item label="Position X (PDF pt)">
        <InputNumber
          value={Math.round(selected.bounds.x * 10) / 10}
          onChange={(value) =>
            updateTextObject(
              selected.id,
              {
                bounds: { ...selected.bounds, x: Number(value ?? selected.bounds.x) },
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
          value={Math.round(selected.bounds.y * 10) / 10}
          onChange={(value) =>
            updateTextObject(
              selected.id,
              {
                bounds: { ...selected.bounds, y: Number(value ?? selected.bounds.y) },
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
          min={MIN_TEXT_BOX_WIDTH_PT}
          step={0.5}
          value={Math.round(selected.bounds.width * 10) / 10}
          onChange={(value) =>
            updateTextObject(
              selected.id,
              {
                bounds: {
                  ...selected.bounds,
                  width: Number(value ?? selected.bounds.width),
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
          min={MIN_TEXT_BOX_HEIGHT_PT}
          step={0.5}
          value={Math.round(selected.bounds.height * 10) / 10}
          onChange={(value) =>
            updateTextObject(
              selected.id,
              {
                bounds: {
                  ...selected.bounds,
                  height: Number(value ?? selected.bounds.height),
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
