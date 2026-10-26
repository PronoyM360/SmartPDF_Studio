import { PictureOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'

const { Paragraph } = Typography

export function ImageToolsPlaceholder() {
  return (
    <Card title="Image Tools">
      <Empty
        image={<PictureOutlined style={{ fontSize: 48, color: '#94a3b8' }} />}
        description={
          <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            Image placement and asset references will be handled here, with export
            via pdf-lib in a future step.
          </Paragraph>
        }
      />
    </Card>
  )
}
