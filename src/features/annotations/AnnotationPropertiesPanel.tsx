import { DeleteOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Space } from 'antd'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { ANNOTATION_COLORS, type AnnotationOverlayObject } from '@/types/annotationOverlay'
import styles from './AnnotationPropertiesPanel.module.css'

interface AnnotationPropertiesPanelProps {
  object: AnnotationOverlayObject
}

export function AnnotationPropertiesPanel({ object }: AnnotationPropertiesPanelProps) {
  const { updateAnnotationObject, commitOverlayHistoryStep, deleteSelectedObject } = useEditorSession()

  return (
    <Form layout="vertical" size="small">
      <Alert
        type="info"
        showIcon
        className={styles.alert}
        message="PDF annotation"
        description="Exported as a standard comment annotation. It does not change or hide the page content, and recipients can hide or delete it."
      />
      <Form.Item label="Note">
        <Input.TextArea
          rows={4}
          value={object.note}
          onChange={(event) =>
            updateAnnotationObject(object.id, { note: event.target.value }, { recordHistory: false })
          }
          onBlur={commitOverlayHistoryStep}
          aria-label="Annotation note"
        />
      </Form.Item>
      <Form.Item label="Colour">
        <Space size={6}>
          {ANNOTATION_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={color === object.color ? styles.swatchActive : styles.swatch}
              style={{ background: color }}
              aria-label={`Annotation colour ${color}`}
              aria-pressed={color === object.color}
              onClick={() => updateAnnotationObject(object.id, { color })}
            />
          ))}
        </Space>
      </Form.Item>
      <Button size="small" danger icon={<DeleteOutlined />} onClick={deleteSelectedObject}>
        Delete annotation
      </Button>
    </Form>
  )
}
