import { ConfigProvider, theme, type ThemeConfig } from 'antd'
import { useEffect, useMemo, type ReactNode } from 'react'
import { usePrefersDarkMode } from '@/hooks/usePrefersDarkMode'

interface AppProvidersProps {
  children: ReactNode
}

const FONT_FAMILY =
  "'Inter', 'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', sans-serif"

function buildTheme(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      // Dark primary is deepened so white button labels keep WCAG AA contrast.
      colorPrimary: dark ? '#3d6cf2' : '#2563eb',
      colorSuccess: dark ? '#22c55e' : '#16a34a',
      colorWarning: dark ? '#f59e0b' : '#d97706',
      colorError: dark ? '#ef4444' : '#dc2626',
      colorInfo: dark ? '#3d6cf2' : '#2563eb',
      colorTextBase: dark ? '#e6eaf1' : '#0f172a',
      colorBgBase: dark ? '#11151d' : '#ffffff',
      colorBgLayout: dark ? '#0d1017' : '#eef1f6',
      colorBgContainer: dark ? '#151922' : '#ffffff',
      colorBgElevated: dark ? '#1b202b' : '#ffffff',
      colorBorder: dark ? '#363e4f' : '#d5dbe5',
      colorBorderSecondary: dark ? '#272d3a' : '#e3e7ef',
      colorTextSecondary: dark ? '#a3adbf' : '#5b6678',
      colorTextTertiary: dark ? '#7d879a' : '#7b8598',
      borderRadius: 8,
      borderRadiusSM: 6,
      borderRadiusLG: 12,
      fontSize: 14,
      fontSizeSM: 12,
      controlHeight: 34,
      controlHeightSM: 28,
      controlHeightLG: 40,
      fontFamily: FONT_FAMILY,
      lineWidthFocus: 2,
      motionDurationFast: '0.12s',
      motionDurationMid: '0.18s',
      motionDurationSlow: '0.28s',
      motionEaseInOut: 'cubic-bezier(0.2, 0, 0, 1)',
      boxShadowSecondary: dark
        ? '0 2px 4px rgba(0,0,0,0.35), 0 16px 40px -8px rgba(0,0,0,0.6)'
        : '0 2px 4px rgba(15,23,42,0.05), 0 12px 32px -6px rgba(15,23,42,0.18)',
    },
    components: {
      Button: {
        controlHeight: 34,
        controlHeightSM: 28,
        paddingInline: 14,
        paddingInlineSM: 10,
        fontWeight: 500,
        primaryShadow: 'none',
        defaultShadow: 'none',
        dangerShadow: 'none',
      },
      Input: {
        activeShadow: dark
          ? '0 0 0 3px rgba(91, 140, 255, 0.22)'
          : '0 0 0 3px rgba(37, 99, 235, 0.14)',
      },
      Segmented: {
        itemSelectedBg: dark ? '#262c39' : '#ffffff',
        trackBg: dark ? '#11151d' : '#eef1f6',
      },
      Tabs: {
        horizontalItemPadding: '8px 2px',
        horizontalItemGutter: 18,
        titleFontSizeSM: 13,
      },
      Tooltip: {
        colorBgSpotlight: dark ? '#2a303d' : '#0f172a',
      },
      Drawer: {
        footerPaddingBlock: 12,
        footerPaddingInline: 16,
      },
      Layout: {
        headerBg: dark ? '#151922' : '#ffffff',
        bodyBg: dark ? '#0d1017' : '#eef1f6',
        siderBg: dark ? '#151922' : '#ffffff',
      },
    },
  }
}

export function AppProviders({ children }: AppProvidersProps) {
  const prefersDark = usePrefersDarkMode()
  const themeConfig = useMemo(() => buildTheme(prefersDark), [prefersDark])

  useEffect(() => {
    // Static Modal.confirm / message calls render outside this tree.
    ConfigProvider.config({
      holderRender: (node) => <ConfigProvider theme={themeConfig}>{node}</ConfigProvider>,
    })
  }, [themeConfig])

  return <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>
}
