import { EyeOutlined } from '@ant-design/icons'
import { Card, Empty, Typography } from 'antd'

const { Paragraph } = Typography

export function PdfViewerPlaceholder() {
  return (
    <Card title="PDF Viewer">
      <Empty
        image={<EyeOutlined style={{ fontSize: 48, color: '#94a3b8' }} />}
        description={
          <Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto' }}>
            Page rendering with PDF.js will live here. The viewer will read from
            immutable source bytes while displaying scaled canvases.
          </Paragraph>
        }
      />
    </Card>
  )
}
