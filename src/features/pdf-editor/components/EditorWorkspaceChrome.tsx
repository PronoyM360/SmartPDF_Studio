import { useState } from 'react'
import type { PdfSource } from '@/types'
import type { DocumentRecordSource } from '@/types/documentRecord'
import type { OverlayObject } from '@/types/overlayObjects'
import type { ExportQualityReport } from '@/lib/pdf/export/exportQualityChecks'
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

interface ExportComparison {
  bytes: Uint8Array
  verified: boolean
  operations: readonly OverlayObject[]
}

function comparisonFromReport(bytes: Uint8Array, report: ExportQualityReport): ExportComparison {
  return {
    bytes,
    verified: report.canDownload && !report.checks.some((check) => check.status === 'warning'),
    operations: report.exportResult?.operations ?? [],
  }
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
    getCommittedOverlayObjects,
    commitOverlayHistoryStep,
    canUndo,
    canRedo,
    undo,
    redo,
  } = useEditorSession()

  const [comparison, setComparison] = useState<ExportComparison | null>(null)

  const {
    openExportQualityCheck,
    closeExportQualityCheck,
    qualityCheckOpen,
    completeDownload,
    isExporting,
    lastExportedBytes,
    lastQualityReport,
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
        onCompareExport={() => {
          if (lastExportedBytes && lastQualityReport) {
            setComparison(comparisonFromReport(lastExportedBytes, lastQualityReport))
          }
        }}
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
        getCommittedOverlays={getCommittedOverlayObjects}
        onCommitPendingEdits={commitOverlayHistoryStep}
        getImageBytes={getImageBytes}
        expectedPageCount={pageCount}
        onDownload={completeDownload}
        onCompare={(bytes, report) => setComparison(comparisonFromReport(bytes, report))}
      />
      <ExportCompareModal
        open={comparison !== null}
        onClose={() => setComparison(null)}
        exportedBytes={comparison?.bytes ?? null}
        verificationOk={comparison?.verified ?? false}
        expectedOverlays={comparison?.operations ?? []}
        activePage={activePage}
        pageCount={pageCount}
        onPageChange={onPageChange}
        initialZoom={zoomPercent}
      />
    </>
  )
}
