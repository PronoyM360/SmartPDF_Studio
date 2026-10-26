import {
  ArrowLeftOutlined,
  ExportOutlined,
  FileSyncOutlined,
  FullscreenOutlined,
  MenuOutlined,
  MinusOutlined,
  PlusOutlined,
  RedoOutlined,
  SaveOutlined,
  SettingOutlined,
  SplitCellsOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Button, Input, Space, Spin, Tag, Tooltip } from 'antd'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import type { LayoutMode } from '@/hooks/useBreakpoint'
import styles from './EditorToolbar.module.css'

interface EditorToolbarProps {
  layoutMode: LayoutMode
  documentName: string
  onDocumentNameChange: (value: string) => void
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  fitMode: FitMode
  onFitToPage: () => void
  onBack: () => void
  onOpenPagesPanel?: () => void
  onOpenPropertiesPanel?: () => void
  onReplacePdf?: () => void
  replaceDisabled?: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onSaveProject?: () => void
  saveProjectDisabled?: boolean
  isSavingProject?: boolean
  onExport: () => void
  exportDisabled: boolean
  isExporting: boolean
  exportProgressMessage?: string | null
  onCompare?: () => void
  compareDisabled?: boolean
  onCompareExport?: () => void
  compareExportDisabled?: boolean
  saveStatusLabel?: string
  saveStatusTone?: 'neutral' | 'warning' | 'success' | 'error'
  saveStatusTooltip?: string
}

export function EditorToolbar({
  layoutMode,
  documentName,
  onDocumentNameChange,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  fitMode,
  onFitToPage,
  onBack,
  onOpenPagesPanel,
  onOpenPropertiesPanel,
  onReplacePdf,
  replaceDisabled = false,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSaveProject,
  saveProjectDisabled = false,
  isSavingProject = false,
  onExport,
  exportDisabled,
  isExporting,
  exportProgressMessage,
  onCompare,
  compareDisabled = false,
  onCompareExport,
  compareExportDisabled = false,
  saveStatusLabel,
  saveStatusTone = 'neutral',
  saveStatusTooltip,
}: EditorToolbarProps) {
  const isMobile = layoutMode === 'mobile'
  const isCompact = layoutMode === 'mobile' || layoutMode === 'tablet'

  return (
    <div className={styles.bar} role="toolbar" aria-label="Editor toolbar">
      <div className={styles.group}>
        <Tooltip title="Back to dashboard">
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            aria-label="Back to dashboard"
          />
        </Tooltip>
        {isCompact ? (
          <>
            <Tooltip title="Pages">
              <Button
                type="text"
                size="small"
                icon={<MenuOutlined />}
                onClick={onOpenPagesPanel}
                aria-label="Open pages panel"
              />
            </Tooltip>
            <Tooltip title="Properties">
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined />}
                onClick={onOpenPropertiesPanel}
                aria-label="Open properties panel"
              />
            </Tooltip>
          </>
        ) : null}
        <Input
          className={styles.docName}
          size="small"
          value={documentName}
          onChange={(event) => onDocumentNameChange(event.target.value)}
          aria-label="Document name"
        />
        {saveStatusLabel ? (
          <Tooltip title={saveStatusTooltip}>
            <Tag
              className={styles.saveTag}
              bordered={false}
              color={
                saveStatusTone === 'warning'
                  ? 'warning'
                  : saveStatusTone === 'success'
                    ? 'success'
                    : saveStatusTone === 'error'
                      ? 'error'
                      : 'default'
              }
            >
              {isExporting ? (
                <span className={styles.exportStatus}>
                  <Spin size="small" /> {exportProgressMessage ?? 'Exporting…'}
                </span>
              ) : (
                saveStatusLabel
              )}
            </Tag>
          </Tooltip>
        ) : null}
      </div>

      <div className={styles.groupCenter}>
        <Space size={4} className={styles.actionCluster}>
          {onSaveProject ? (
            <Tooltip title="Save project locally (this browser only, not cloud backup)">
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={onSaveProject}
                disabled={saveProjectDisabled || isExporting}
                loading={isSavingProject}
                aria-label="Save project"
              >
                {isMobile ? null : 'Save'}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title="Undo (Ctrl+Z)">
            <Button
              size="small"
              icon={<UndoOutlined />}
              disabled={!canUndo || isExporting}
              onClick={onUndo}
              aria-label="Undo"
            />
          </Tooltip>
          <Tooltip title="Redo (Ctrl+Y)">
            <Button
              size="small"
              icon={<RedoOutlined />}
              disabled={!canRedo || isExporting}
              onClick={onRedo}
              aria-label="Redo"
            />
          </Tooltip>
        </Space>

        <Space size={4} className={styles.zoom}>
          <Tooltip title="Zoom out">
            <Button
              size="small"
              icon={<MinusOutlined />}
              onClick={onZoomOut}
              aria-label="Zoom out"
            />
          </Tooltip>
          <Button
            size="small"
            type="text"
            onClick={onZoomReset}
            aria-label="Reset zoom to 100 percent"
            className={styles.zoomLabel}
          >
            {zoomPercent}%
          </Button>
          <Tooltip title="Zoom in">
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={onZoomIn}
              aria-label="Zoom in"
            />
          </Tooltip>
        </Space>

        <Tooltip title="Fit entire page in view">
          <Button
            size="small"
            type={fitMode === 'page' ? 'primary' : 'default'}
            icon={<FullscreenOutlined />}
            onClick={onFitToPage}
            aria-pressed={fitMode === 'page'}
            aria-label="Fit to page"
          >
            {isMobile ? null : 'Fit page'}
          </Button>
        </Tooltip>
      </div>

      <div className={styles.groupEnd}>
        {onCompare ? (
          <Tooltip title="Full-screen compare (original vs overlay preview). Use the canvas switcher for quick Original / Edited / Side by side.">
            <Button
              size="small"
              icon={<SplitCellsOutlined />}
              onClick={onCompare}
              disabled={compareDisabled || isExporting}
              aria-label="Compare documents"
            />
          </Tooltip>
        ) : null}
        {onCompareExport ? (
          <Tooltip title="Compare original upload with last exported PDF">
            <Button
              size="small"
              onClick={onCompareExport}
              disabled={compareExportDisabled || isExporting}
              aria-label="Compare last export"
            >
              {isMobile ? 'Export Δ' : 'Compare export'}
            </Button>
          </Tooltip>
        ) : null}
        {onReplacePdf ? (
          <Tooltip title="Replace with another PDF">
            <Button
              size="small"
              icon={<FileSyncOutlined />}
              onClick={onReplacePdf}
              disabled={replaceDisabled || isExporting}
              aria-label="Replace PDF"
            />
          </Tooltip>
        ) : null}
        <Tooltip title="Download PDF with your overlay edits">
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            disabled={exportDisabled}
            loading={isExporting}
            onClick={onExport}
            aria-label="Download PDF"
            className={styles.downloadBtn}
          >
            {isMobile ? 'Download' : 'Download PDF'}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
