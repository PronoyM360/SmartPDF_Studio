import { Form, Input, InputNumber, Select, Slider, Space } from 'antd'
import { buildTextFontFamilyOptions } from '@/features/text-tools/buildTextFontFamilyOptions'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import { normalizeHexForColorInput } from '@/lib/pdf/export/colorUtils'
import type { TextReplacementStyleOverrides } from '@/features/text-tools/useTextReplacementPlanOverrides'
import styles from './TextReplacementStyleControls.module.css'

interface TextReplacementStyleControlsProps {
  plan: TextReplacementPlan
  pdfFontName?: string | null
  onPatch: (patch: TextReplacementStyleOverrides) => void
}

export function TextReplacementStyleControls({
  plan,
  pdfFontName,
  onPatch,
}: TextReplacementStyleControlsProps) {
  const fontOptions = buildTextFontFamilyOptions({
    pdfFontName,
    selectedFamily: plan.fontFamily,
  })

  const maskFill = normalizeHexForColorInput(plan.maskFillColor, '#ffffff')
  const textColor = normalizeHexForColorInput(plan.color, '#0f172a')

  return (
    <>
      <Form.Item
        label="Overlay font"
        extra="Pick the PDF name when installed on your system, or the closest web font."
      >
        <Select
          showSearch
          optionFilterProp="label"
          value={plan.fontFamily}
          options={fontOptions}
          onChange={(value) => onPatch({ fontFamily: value })}
        />
      </Form.Item>
      <Space wrap className={styles.row}>
        <Form.Item label="Size (pt)" style={{ marginBottom: 0 }}>
          <InputNumber
            min={6}
            max={120}
            value={Math.round(plan.fontSize * 10) / 10}
            onChange={(value) =>
              onPatch({ fontSize: Number(value ?? plan.fontSize) })
            }
          />
        </Form.Item>
        <Form.Item label="Weight" style={{ marginBottom: 0 }}>
          <Select
            value={plan.fontWeight}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'bold', label: 'Bold' },
            ]}
            onChange={(value) =>
              onPatch({ fontWeight: value as TextReplacementPlan['fontWeight'] })
            }
          />
        </Form.Item>
      </Space>
      <Form.Item label="Text color">
        <Space wrap align="center">
          <Input
            type="color"
            value={textColor}
            onChange={(event) => onPatch({ color: event.target.value })}
            aria-label="Replacement text color"
          />
          <Input
            size="small"
            value={plan.color}
            onChange={(event) => onPatch({ color: event.target.value })}
            className={styles.hexInput}
            aria-label="Text color hex"
          />
        </Space>
      </Form.Item>
      <Form.Item
        label="Mask background"
        extra="Flat color behind the replacement text — adjust if auto-sampling missed the page."
      >
        <Space wrap align="center">
          <Input
            type="color"
            value={maskFill}
            onChange={(event) => onPatch({ maskFillColor: event.target.value })}
            aria-label="Mask background color"
          />
          <Input
            size="small"
            value={plan.maskFillColor}
            onChange={(event) => onPatch({ maskFillColor: event.target.value })}
            className={styles.hexInput}
            aria-label="Mask background hex"
          />
        </Space>
      </Form.Item>
      <Form.Item label={`Mask opacity (${Math.round(plan.maskOpacity * 100)}%)`}>
        <Slider
          min={0.05}
          max={1}
          step={0.05}
          value={plan.maskOpacity}
          onChange={(value) => onPatch({ maskOpacity: Number(value) })}
        />
      </Form.Item>
    </>
  )
}
