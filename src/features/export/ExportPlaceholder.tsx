import { ExportOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'

const { Paragraph } = Typography

export function ExportPlaceholder() {
  return (
    <Card title="Export">
      <Empty
        image={<ExportOutlined style={{ fontSize: 48, color: '#94a3b8' }} />}
        description={
          <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            Modified PDF download will merge editing operations through pdf-lib
            without overwriting the stored original bytes.
          </Paragraph>
        }
      />
    </Card>
  )
}
