import type { ReactNode } from 'react'
import { BrandMark } from '@/components/common/BrandMark'
import styles from './AppHeader.module.css'

interface AppHeaderProps {
  actions?: ReactNode
}

export function AppHeader({ actions }: AppHeaderProps) {
  return (
    <header className={styles.header}>
      <BrandMark />
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
