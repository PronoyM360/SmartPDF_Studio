import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Button, Form, InputNumber, Space, Switch, Typography } from 'antd'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import type { ImageOverlayObject } from '@/types/imageOverlay'
import styles from './ImagePropertiesPanel.module.css'

const { Text } = Typography

const LIVE = { recordHistory: false } as const

interface ImagePropertiesPanelProps {
  object: ImageOverlayObject
}

export function ImagePropertiesPanel({ object }: ImagePropertiesPanelProps) {
  const {
    updateImageObject,
    deleteSelectedObject,
    duplicateSelectedObject,
    getImageAsset,
    commitOverlayHistoryStep,
  } = useEditorSession()
  const asset = getImageAsset(object.assetId)

  const commit = (): void => {
    commitOverlayHistoryStep()
  }

  return (
    <Form layout="vertical" size="small" className={styles.form}>
      <Form.Item label="Source">
        <span className={styles.meta}>
          {asset ? `${asset.pixelWidth}×${asset.pixelHeight}px` : 'Image asset'}
        </span>
      </Form.Item>
      <Text type="secondary" className={styles.hint}>
        Rotation is applied to the overlay at export. Drag corner handles with aspect
        ratio locked by default.
      </Text>
      <Form.Item label="Rotation (°)">
        <InputNumber
          min={-180}
          max={180}
          value={Math.round(object.rotation)}
          onChange={(value) =>
            updateImageObject(object.id, { rotation: Number(value ?? 0) }, LIVE)
          }
          onBlur={commit}
          className={styles.fullWidth}
        />
      </Form.Item>
      <Form.Item label="Lock aspect ratio">
        <Switch
          checked={object.lockAspectRatio}
          onChange={(checked) =>
            updateImageObject(object.id, { lockAspectRatio: checked })
          }
        />
      </Form.Item>
      <Form.Item label="Position X (PDF pt)">
        <InputNumber
          value={Math.round(object.bounds.x * 10) / 10}
          onChange={(value) =>
            updateImageObject(
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
            updateImageObject(
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
          min={24}
          value={Math.round(object.bounds.width * 10) / 10}
          onChange={(value) =>
            updateImageObject(
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
          min={24}
          value={Math.round(object.bounds.height * 10) / 10}
          onChange={(value) =>
            updateImageObject(
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
