import { Typography } from 'antd'
import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

const { Text, Title } = Typography

interface EmptyStateProps {
  title: string
  description: string
  icon?: ReactNode
  action?: ReactNode
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className={styles.root} role="status">
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <Title level={5} className={styles.title}>
        {title}
      </Title>
      <Text type="secondary" className={styles.description}>
        {description}
      </Text>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
