import { FilePdfOutlined } from '@ant-design/icons'
import styles from './BrandMark.module.css'

interface BrandMarkProps {
  compact?: boolean
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={compact ? styles.compact : styles.full} aria-label="SmartPDF Studio">
      <span className={styles.icon} aria-hidden>
        <FilePdfOutlined />
      </span>
      <span className={styles.name}>SmartPDF Studio</span>
    </div>
  )
}
