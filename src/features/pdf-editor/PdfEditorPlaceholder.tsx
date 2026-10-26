import { EditOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'

const { Paragraph } = Typography

export function PdfEditorPlaceholder() {
  return (
    <Card title="PDF Editor">
      <Empty
        image={<EditOutlined style={{ fontSize: 48, color: '#94a3b8' }} />}
        description={
          <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            React-Konva overlay layers will mount here for selection, pan, and
            object transforms. Editing state stays separate from the original PDF
            bytes.
          </Paragraph>
        }
      />
    </Card>
  )
}
