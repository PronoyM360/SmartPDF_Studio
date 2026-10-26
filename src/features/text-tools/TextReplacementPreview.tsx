import { Typography } from 'antd'
import styles from './TextReplacementPreview.module.css'

const { Text } = Typography

interface TextReplacementPreviewProps {
  replacementText: string
  fontFamily: string
  fontSizePt: number
  color: string
  fontWeight?: 'normal' | 'bold'
  maskFillColor: string
}

export function TextReplacementPreview({
  replacementText,
  fontFamily,
  fontSizePt,
  color,
  fontWeight = 'normal',
  maskFillColor,
}: TextReplacementPreviewProps) {
  const previewFontSize = Math.min(Math.max(fontSizePt * 0.85, 11), 28)

  return (
    <div className={styles.root} aria-label="Replacement preview">
      <Text type="secondary" className={styles.label}>
        Preview (approximate)
      </Text>
      <div className={styles.stage} style={{ background: maskFillColor }}>
        <span
          className={styles.text}
          style={{
            fontFamily,
            fontSize: previewFontSize,
            color,
            fontWeight: fontWeight === 'bold' ? 700 : 400,
          }}
        >
          {replacementText.trim() || '…'}
        </span>
      </div>
    </div>
  )
}
