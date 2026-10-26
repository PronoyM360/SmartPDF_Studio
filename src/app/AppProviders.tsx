import { ConfigProvider, theme } from 'antd'
import type { ReactNode } from 'react'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 6,
          fontSize: 14,
          controlHeight: 32,
          fontFamily:
            "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', sans-serif",
        },
        components: {
          Button: {
            controlHeight: 32,
            paddingInline: 12,
          },
          Layout: {
            headerBg: '#ffffff',
            bodyBg: '#f4f6fb',
            siderBg: '#ffffff',
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  )
}
