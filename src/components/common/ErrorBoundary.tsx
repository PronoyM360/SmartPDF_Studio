import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Result } from 'antd'

interface ErrorBoundaryProps {
  children: ReactNode
  title?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SmartPDF Studio]', error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    const { children, title = 'Something went wrong' } = this.props

    if (error) {
      return (
        <Result
          status="error"
          title={title}
          subTitle={error.message}
          extra={
            <Button type="primary" onClick={this.handleRetry}>
              Try again
            </Button>
          }
        />
      )
    }

    return children
  }
}
