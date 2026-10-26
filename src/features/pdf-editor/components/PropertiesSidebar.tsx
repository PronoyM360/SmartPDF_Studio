import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Tabs, Tooltip, Typography } from 'antd'
import { EDITOR_TOOLS } from '@/app/editorTools'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { OverlayPropertiesPanel } from '@/features/pdf-editor/components/OverlayPropertiesPanel'
import { OcrInspectionPanel } from '@/features/ocr/OcrInspectionPanel'
import { PdfTextInspectionPanel } from '@/features/text-tools/PdfTextInspectionPanel'
import styles from './PropertiesSidebar.module.css'

const { Text, Title } = Typography

export type PropertiesTabKey = 'overlays' | 'pdf-text' | 'ocr'

interface PropertiesSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  activePage: number
  renderScale: number
  activeTabKey?: PropertiesTabKey
  onTabChange?: (key: PropertiesTabKey) => void
}

export function PropertiesSidebar({
  collapsed,
  onToggleCollapse,
  activePage,
  renderScale,
  activeTabKey = 'overlays',
  onTabChange,
}: PropertiesSidebarProps) {
  const { activeToolId } = useEditorSession()
  const activeTool =
    EDITOR_TOOLS.find((tool) => tool.id === activeToolId) ?? EDITOR_TOOLS[0]!

  return (
    <aside
      className={collapsed ? styles.rootCollapsed : styles.root}
      aria-label="Properties sidebar"
    >
      <div className={styles.header}>
        <Tooltip title={collapsed ? 'Expand properties' : 'Collapse properties'}>
          <Button
            type="text"
            size="small"
            icon={collapsed ? <LeftOutlined /> : <RightOutlined />}
            onClick={onToggleCollapse}
            aria-label={
              collapsed ? 'Expand properties sidebar' : 'Collapse properties sidebar'
            }
          />
        </Tooltip>
        {!collapsed ? (
          <Text strong className={styles.title}>
            Properties
          </Text>
        ) : null}
      </div>
      {!collapsed ? (
        <div className={styles.body}>
          <Tabs
            size="small"
            activeKey={activeTabKey}
            onChange={(key) => onTabChange?.(key as PropertiesTabKey)}
            items={[
              {
                key: 'overlays',
                label: 'Overlays',
                children: (
                  <>
                    <Title level={5} className={styles.toolTitle}>
                      {activeTool.label}
                    </Title>
                    <Text type="secondary" className={styles.toolDescription}>
                      {activeTool.description}
                    </Text>
                    <OverlayPropertiesPanel
                      activePage={activePage}
                      renderScale={renderScale}
                    />
                  </>
                ),
              },
              {
                key: 'pdf-text',
                label: 'Find / Replace',
                children: <PdfTextInspectionPanel />,
              },
              {
                key: 'ocr',
                label: 'OCR',
                children: <OcrInspectionPanel />,
              },
            ]}
          />
        </div>
      ) : null}
    </aside>
  )
}
