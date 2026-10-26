import { useState } from 'react'
import type { PdfSource } from '@/types'
import type { DocumentRecordSource } from '@/types/documentRecord'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'
import { ExportCompareModal } from '@/features/export/ExportCompareModal'
import { ExportQualityCheckModal } from '@/features/export/ExportQualityCheckModal'
import { usePdfExport } from '@/features/export/usePdfExport'
import type { FitMode } from '@/features/pdf-editor/components/PdfWorkspace'
import { EditorToolbar } from './EditorToolbar'
import type { LayoutMode } from '@/hooks/useBreakpoint'

interface EditorWorkspaceChromeProps {
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
  onOpenPagesPanel: () => void
  onOpenPropertiesPanel: () => void
  onReplacePdf: () => void
  pdfSource: PdfSource | null
  documentSource: DocumentRecordSource
  activePage: number
  pageCount: number
  onPageChange: (page: number) => void
  onCompare?: () => void
  saveStatusLabel?: string
  saveStatusTone?: 'neutral' | 'warning' | 'success' | 'error'
  saveStatusTooltip?: string
  onSaveProject?: () => void
  saveProjectDisabled?: boolean
  isSavingProject?: boolean
}

export function EditorWorkspaceChrome({
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
  pdfSource,
  documentSource,
  activePage,
  pageCount,
  onPageChange,
  onCompare,
  saveStatusLabel,
  saveStatusTone,
  saveStatusTooltip,
  onSaveProject,
  saveProjectDisabled,
  isSavingProject,
}: EditorWorkspaceChromeProps) {
  const {
    overlayObjects,
    getImageAssetBytes,
    canUndo,
    canRedo,
    undo,
    redo,
  } = useEditorSession()

  const [exportCompareOpen, setExportCompareOpen] = useState(false)

  const {
    openExportQualityCheck,
    closeExportQualityCheck,
    qualityCheckOpen,
    completeDownload,
    isExporting,
    lastExportedBytes,
    lastExportVerified,
    hasExportCompare,
    overlayObjects: exportOverlays,
    getImageBytes,
    source: exportSource,
  } = usePdfExport({
    source: pdfSource,
    documentName,
    overlayObjects,
    getImageBytes: getImageAssetBytes,
  })

  const canExport =
    Boolean(pdfSource) &&
    documentSource === 'user' &&
    !isExporting

  return (
    <>
      <EditorToolbar
        layoutMode={layoutMode}
        documentName={documentName}
        onDocumentNameChange={onDocumentNameChange}
        zoomPercent={zoomPercent}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        fitMode={fitMode}
        onFitToPage={onFitToPage}
        onBack={onBack}
        onOpenPagesPanel={onOpenPagesPanel}
        onOpenPropertiesPanel={onOpenPropertiesPanel}
        onReplacePdf={onReplacePdf}
        replaceDisabled={!pdfSource}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSaveProject={onSaveProject}
        saveProjectDisabled={saveProjectDisabled}
        isSavingProject={isSavingProject}
        onExport={openExportQualityCheck}
        exportDisabled={!canExport}
        isExporting={isExporting}
        exportProgressMessage={null}
        onCompare={onCompare}
        compareDisabled={!pdfSource}
        onCompareExport={() => setExportCompareOpen(true)}
        compareExportDisabled={!hasExportCompare}
        saveStatusLabel={saveStatusLabel}
        saveStatusTone={saveStatusTone}
        saveStatusTooltip={saveStatusTooltip}
      />
      <ExportQualityCheckModal
        open={qualityCheckOpen}
        onClose={closeExportQualityCheck}
        source={exportSource}
        overlays={exportOverlays}
        getImageBytes={getImageBytes}
        expectedPageCount={pageCount}
        onDownload={completeDownload}
      />
      <ExportCompareModal
        open={exportCompareOpen}
        onClose={() => setExportCompareOpen(false)}
        exportedBytes={lastExportedBytes}
        verificationOk={lastExportVerified}
        activePage={activePage}
        pageCount={pageCount}
        onPageChange={onPageChange}
        initialZoom={zoomPercent}
      />
    </>
  )
}
