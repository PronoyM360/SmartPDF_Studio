import { FontSizeOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'

const { Paragraph } = Typography

export function TextToolsPlaceholder() {
  return (
    <Card title="Text Tools">
      <Empty
        image={<FontSizeOutlined style={{ fontSize: 48, color: '#94a3b8' }} />}
        description={
          <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            Text overlay authoring and typography controls will be added in a
            later step.
          </Paragraph>
        }
      />
    </Card>
  )
}
