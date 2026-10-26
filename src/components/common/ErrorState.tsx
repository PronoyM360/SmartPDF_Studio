import { Button, Result } from 'antd'
import type { ReactNode } from 'react'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
  extra?: ReactNode
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  extra,
}: ErrorStateProps) {
  return (
    <Result
      status="error"
      title={title}
      subTitle={message}
      extra={
        extra ??
        (onRetry ? (
          <Button type="primary" size="small" onClick={onRetry}>
            Try again
          </Button>
        ) : null)
      }
    />
  )
}
