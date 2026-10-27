import {
  BorderOutlined,
  DollarOutlined,
  EditOutlined,
  FontSizeOutlined,
  HighlightOutlined,
  HolderOutlined,
  PictureOutlined,
  ProfileOutlined,
} from '@ant-design/icons'
import { Tooltip } from 'antd'
import { useRef, type ReactNode } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import type { EditorToolId } from '@/types'
import type { PropertiesTabKey } from './PropertiesSidebar'
import styles from './EditorLeftRail.module.css'

type RailActionId = EditorToolId | 'edit-pdf-text' | 'edit-prices' | 'detect-sections'

interface RailButton {
  id: RailActionId
  label: string
  icon: ReactNode
  shortcut?: string
}

const RAIL_BUTTONS: RailButton[] = [
  { id: 'select', label: 'Select', icon: <BorderOutlined />, shortcut: 'V' },
  { id: 'edit-pdf-text', label: 'Edit PDF text', icon: <EditOutlined /> },
  { id: 'edit-prices', label: 'Edit prices & amounts', icon: <DollarOutlined /> },
  { id: 'detect-sections', label: 'Detect sections', icon: <ProfileOutlined /> },
  { id: 'text', label: 'Add text', icon: <FontSizeOutlined />, shortcut: 'T' },
  { id: 'image', label: 'Add image', icon: <PictureOutlined /> },
  { id: 'highlight', label: 'Mask / erase area', icon: <HighlightOutlined />, shortcut: 'M' },
  { id: 'pan', label: 'Hand / pan', icon: <HolderOutlined />, shortcut: 'H' },
]

interface EditorLeftRailProps {
  propertiesTabKey: PropertiesTabKey
  onOpenPdfTextPanel: () => void
  onOpenPricesPanel: () => void
  onOpenSectionsPanel: () => void
  layoutMode: 'desktop' | 'tablet' | 'mobile'
}

export function EditorLeftRail({
  propertiesTabKey,
  onOpenPdfTextPanel,
  onOpenPricesPanel,
  onOpenSectionsPanel,
  layoutMode,
}: EditorLeftRailProps) {
  const {
    activeToolId,
    setActiveToolId,
    selectObject,
    ingestImageFile,
  } = useEditorSession()
  const imageInputRef = useRef<HTMLInputElement>(null)

  const isVertical = layoutMode !== 'mobile'

  const handleToolClick = (id: RailActionId): void => {
    if (id === 'edit-pdf-text') {
      setActiveToolId('select')
      selectObject(null)
      onOpenPdfTextPanel()
      return
    }
    if (id === 'detect-sections') {
      setActiveToolId('select')
      selectObject(null)
      onOpenSectionsPanel()
      return
    }
    if (id === 'edit-prices') {
      setActiveToolId('select')
      selectObject(null)
      onOpenPricesPanel()
      return
    }
    if (id === 'image') {
      imageInputRef.current?.click()
      return
    }
    setActiveToolId(id)
    if (id !== 'select') {
      selectObject(null)
    }
  }

  const isActive = (id: RailActionId): boolean => {
    if (id === 'edit-pdf-text') {
      return propertiesTabKey === 'pdf-text' && activeToolId === 'select'
    }
    if (id === 'detect-sections') {
      return propertiesTabKey === 'sections' && activeToolId === 'select'
    }
    if (id === 'edit-prices') {
      return propertiesTabKey === 'prices' && activeToolId === 'select'
    }
    return activeToolId === id
  }

  return (
    <nav
      className={isVertical ? styles.railVertical : styles.railHorizontal}
      role="toolbar"
      aria-label="Editing tools"
    >
      {RAIL_BUTTONS.map((tool) => (
        <Tooltip
          key={tool.id}
          title={
            tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label
          }
          placement={isVertical ? 'right' : 'top'}
        >
          <button
            type="button"
            className={
              isActive(tool.id) ? styles.toolBtnActive : styles.toolBtn
            }
            aria-label={tool.label}
            aria-pressed={isActive(tool.id)}
            onClick={() => handleToolClick(tool.id)}
          >
            {tool.icon}
            {!isVertical ? (
              <span className={styles.toolLabel}>{tool.label}</span>
            ) : null}
          </button>
        </Tooltip>
      ))}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className={styles.hiddenInput}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void ingestImageFile(file)
          }
          event.target.value = ''
        }}
      />
    </nav>
  )
}
