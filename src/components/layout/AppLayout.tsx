import { FilePdfOutlined } from '@ant-design/icons'
import { Layout, Menu, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import styles from './AppLayout.module.css'

const { Header, Sider, Content } = Layout

export type AppSectionId =
  | 'dashboard'
  | 'pdf-viewer'
  | 'pdf-editor'
  | 'text-tools'
  | 'image-tools'
  | 'export'

interface AppLayoutProps {
  activeSection: AppSectionId
  onSectionChange: (section: AppSectionId) => void
  children: ReactNode
}

const menuItems: { key: AppSectionId; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'pdf-viewer', label: 'PDF Viewer' },
  { key: 'pdf-editor', label: 'PDF Editor' },
  { key: 'text-tools', label: 'Text Tools' },
  { key: 'image-tools', label: 'Image Tools' },
  { key: 'export', label: 'Export' },
]

export function AppLayout({
  activeSection,
  onSectionChange,
  children,
}: AppLayoutProps) {
  return (
    <Layout className={styles.shell}>
      <Header className={styles.header}>
        <div className={styles.brand}>
          <Typography.Title level={4} className={styles.brandTitle}>
            <FilePdfOutlined aria-hidden style={{ marginRight: 8 }} />
            SmartPDF Studio
          </Typography.Title>
          <p className={styles.brandTagline}>
            Frontend-only PDF workspace — foundation build
          </p>
        </div>
        <Tag color="processing">Step 1 · Shell</Tag>
      </Header>
      <Layout>
        <Sider width={220} className={styles.sider}>
          <span className={styles.navLabel}>Workspace</span>
          <Menu
            mode="inline"
            selectedKeys={[activeSection]}
            items={menuItems.map((item) => ({
              key: item.key,
              label: item.label,
            }))}
            onClick={({ key }) => onSectionChange(key as AppSectionId)}
          />
        </Sider>
        <Content className={styles.content}>{children}</Content>
      </Layout>
    </Layout>
  )
}
