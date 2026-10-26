import { Alert, Drawer, Modal, Spin } from 'antd'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { StorageResult } from '@/lib/persistence/idb'
import { useDocumentLibrary } from '@/app/DocumentLibraryContext'
import { DocumentComparisonModal } from '@/features/comparison/DocumentComparisonModal'
import { OcrSessionProvider } from '@/features/ocr/OcrSessionContext'
import { EditorPersistenceHost, type EditorSaveStatus } from '@/features/persistence/EditorPersistenceHost'
import { RecoverUnsavedWorkModal } from '@/features/persistence/RecoverUnsavedWorkModal'
import { resolveInitialEditorSession } from '@/features/persistence/resolveInitialEditorSession'
import { restoreFromPersistedSession } from '@/features/persistence/restoreFromPersistedSession'
import { formatLastSavedAt } from '@/lib/persistence/formatLastSaved'
import { PdfTextInspectProvider } from '@/features/text-tools/PdfTextInspectContext'
import { PdfViewerProvider, usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import type { DocumentRecord } from '@/types/documentRecord'
import { EditorKeyboardHost } from './components/EditorKeyboardHost'
import { EditorWorkspaceChrome } from './components/EditorWorkspaceChrome'
import { EditorLeftRail } from './components/EditorLeftRail'
import { EditorStatusBar } from './components/EditorStatusBar'
import { PagesSidebar } from './components/PagesSidebar'
import { PdfWorkspace, type FitMode } from './components/PdfWorkspace'
import {
  PropertiesSidebar,
  type PropertiesTabKey,
} from './components/PropertiesSidebar'
import { EditorPreviewProvider } from './EditorPreviewContext'
import {
  EditorSessionProvider,
  useEditorSession,
  type RestoredEditorSession,
} from './EditorSessionContext'
import {
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  ZOOM_STEP_PERCENT,
} from '@/features/pdf-editor/zoomConfig'
import { WorkspacePreviewModeSwitch } from './components/WorkspacePreviewModeSwitch'
import styles from './EditorWorkspace.module.css'

interface EditorWorkspaceProps {
  document: DocumentRecord
  onBack: () => void
  onDocumentReplaced: (document: DocumentRecord) => void
}

export function EditorWorkspace({
  document,
  onBack,
  onDocumentReplaced,
}: EditorWorkspaceProps) {
  const layoutMode = useBreakpoint()
  const { getSourceForDocument, renameDocument, touchDocument, ingestFile } =
    useDocumentLibrary()
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const [documentName, setDocumentName] = useState(document.name)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [fitMode, setFitMode] = useState<FitMode>('page')
  const [activePage, setActivePage] = useState(1)
  const [pagesCollapsed, setPagesCollapsed] = useState(false)
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false)
  const [pagesDrawerOpen, setPagesDrawerOpen] = useState(false)
  const [propertiesDrawerOpen, setPropertiesDrawerOpen] = useState(false)
  const [persistenceBaseline, setPersistenceBaseline] = useState(0)

  const pdfSource = getSourceForDocument(document.id)
  type UserRestorePhase =
    | { kind: 'loading' }
    | {
        kind: 'recover'
        recoveryAt: string
        savedAt: string | null
        recoveryDocumentName: string
        applyRecovery: () => Promise<void>
        applySaved: () => void
      }
    | { kind: 'ready'; session: RestoredEditorSession | null }

  const [userRestore, setUserRestore] = useState<UserRestorePhase>(
    document.source === 'user' ? { kind: 'loading' } : { kind: 'ready', session: null },
  )

  const applyRestoredPayload = useCallback(
    (
      loaded: {
        session: RestoredEditorSession
        viewport: { activePage: number; zoomPercent: number; fitMode: FitMode }
        documentName?: string
      } | null,
    ): void => {
      if (loaded) {
        setActivePage(loaded.viewport.activePage)
        setZoomPercent(loaded.viewport.zoomPercent)
        setFitMode(loaded.viewport.fitMode)
        if (loaded.documentName?.trim()) {
          setDocumentName(loaded.documentName.trim())
        }
        setUserRestore({ kind: 'ready', session: loaded.session })
        setPersistenceBaseline((value) => value + 1)
      } else {
        setActivePage(1)
        setZoomPercent(100)
        setFitMode('page')
        setUserRestore({ kind: 'ready', session: null })
        setPersistenceBaseline((value) => value + 1)
      }
    },
    [],
  )

  useEffect(() => {
    setDocumentName(document.name)
    if (document.source !== 'user') {
      setActivePage(1)
      setZoomPercent(100)
      setFitMode('page')
      setUserRestore({ kind: 'ready', session: null })
      setPersistenceBaseline((value) => value + 1)
      return
    }
    let cancelled = false
    setUserRestore({ kind: 'loading' })
    setPersistenceBaseline(0)
    void resolveInitialEditorSession(document.id, document.name).then((result) => {
      if (cancelled) {
        return
      }
      if (result.kind === 'recover') {
        setUserRestore({
          kind: 'recover',
          recoveryAt: result.recovery.lastModifiedAt,
          savedAt: result.savedAt,
          recoveryDocumentName: result.documentName,
          applyRecovery: async () => {
            const payload = await restoreFromPersistedSession(result.recovery)
            if (payload) {
              applyRestoredPayload(payload)
            } else {
              applyRestoredPayload(result.savedPayload)
            }
          },
          applySaved: () => {
            applyRestoredPayload(result.savedPayload)
          },
        })
        return
      }
      if (result.kind === 'ready') {
        applyRestoredPayload(result.payload)
        return
      }
      applyRestoredPayload(null)
    })
    return () => {
      cancelled = true
    }
  }, [document.id, document.name, document.source, applyRestoredPayload])

  const restoredSession =
    userRestore.kind === 'ready' ? userRestore.session : null

  useEffect(() => {
    if (layoutMode === 'tablet') {
      setPagesCollapsed(true)
      setPropertiesCollapsed(true)
    } else if (layoutMode === 'desktop') {
      setPagesCollapsed(false)
      setPropertiesCollapsed(false)
    }
  }, [layoutMode])

  const currentPage = Math.min(
    Math.max(activePage, 1),
    Math.max(document.pageCount, 1),
  )

  const handleNameChange = (value: string): void => {
    setDocumentName(value)
    if (document.source === 'user') {
      renameDocument(document.id, value)
      touchDocument(document.id)
    }
  }

  const handleZoomIn = (): void => {
    setZoomPercent((prev) => Math.min(MAX_ZOOM_PERCENT, prev + ZOOM_STEP_PERCENT))
  }

  const handleZoomOut = (): void => {
    setZoomPercent((prev) => Math.max(MIN_ZOOM_PERCENT, prev - ZOOM_STEP_PERCENT))
  }

  const handleFitModeChange = (mode: FitMode): void => {
    setFitMode(mode)
    setZoomPercent(100)
  }

  const handleReplacePdfClick = (): void => {
    replaceInputRef.current?.click()
  }

  const handleReplaceFile = async (file: File): Promise<void> => {
    const record = await ingestFile(file)
    if (record) {
      onDocumentReplaced(record)
    }
  }

  const showInlineSidebars = layoutMode === 'desktop' || layoutMode === 'tablet'

  if (document.source === 'user' && userRestore.kind === 'loading') {
    return (
      <div className={styles.shell}>
        <div className={styles.loading}>
          <Spin tip="Restoring local session…" />
        </div>
      </div>
    )
  }

  if (document.source === 'user' && userRestore.kind === 'recover') {
    return (
      <div className={styles.shell}>
        <div className={styles.loading}>
          <Spin tip="Checking for unsaved work…" />
        </div>
        <RecoverUnsavedWorkModal
          open
          documentName={userRestore.recoveryDocumentName}
          recoveryAt={userRestore.recoveryAt}
          savedAt={userRestore.savedAt}
          onUseRecovery={() => {
            void userRestore.applyRecovery()
          }}
          onUseLastSaved={userRestore.applySaved}
        />
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <PdfViewerProvider source={pdfSource} documentKey={document.id}>
        <EditorSessionProvider
          key={document.id}
          documentId={document.id}
          activePageIndex={currentPage - 1}
          restoredSession={restoredSession}
        >
          <EditorPreviewProvider>
          <EditorWorkspaceWithTextInspect
            document={document}
            currentPage={currentPage}
            setActivePage={setActivePage}
            onBack={onBack}
            layoutMode={layoutMode}
            showInlineSidebars={showInlineSidebars}
            documentName={documentName}
            onDocumentNameChange={handleNameChange}
            zoomPercent={zoomPercent}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={() => setZoomPercent(100)}
            pagesCollapsed={pagesCollapsed}
            setPagesCollapsed={setPagesCollapsed}
            propertiesCollapsed={propertiesCollapsed}
            setPropertiesCollapsed={setPropertiesCollapsed}
            pagesDrawerOpen={pagesDrawerOpen}
            setPagesDrawerOpen={setPagesDrawerOpen}
            propertiesDrawerOpen={propertiesDrawerOpen}
            setPropertiesDrawerOpen={setPropertiesDrawerOpen}
            fitMode={fitMode}
            onFitModeChange={handleFitModeChange}
            onReplacePdfClick={handleReplacePdfClick}
            replaceInputRef={replaceInputRef}
            handleReplaceFile={handleReplaceFile}
            pdfSource={pdfSource}
            persistenceBaseline={persistenceBaseline}
          />
          </EditorPreviewProvider>
        </EditorSessionProvider>
      </PdfViewerProvider>
    </div>
  )
}

interface EditorWorkspaceWithTextInspectProps {
  document: DocumentRecord
  currentPage: number
  setActivePage: (page: number) => void
  layoutMode: ReturnType<typeof useBreakpoint>
  showInlineSidebars: boolean
  documentName: string
  onDocumentNameChange: (value: string) => void
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onBack: () => void
  pagesCollapsed: boolean
  setPagesCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  propertiesCollapsed: boolean
  setPropertiesCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  pagesDrawerOpen: boolean
  setPagesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  propertiesDrawerOpen: boolean
  setPropertiesDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  fitMode: FitMode
  onFitModeChange: (mode: FitMode) => void
  onReplacePdfClick: () => void
  replaceInputRef: RefObject<HTMLInputElement | null>
  handleReplaceFile: (file: File) => Promise<void>
  pdfSource: ReturnType<ReturnType<typeof useDocumentLibrary>['getSourceForDocument']>
  persistenceBaseline: number
}

function EditorWorkspaceWithTextInspect({
  document,
  currentPage,
  setActivePage,
  onBack,
  layoutMode,
  showInlineSidebars,
  documentName,
  onDocumentNameChange,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  pagesCollapsed,
  setPagesCollapsed,
  propertiesCollapsed,
  setPropertiesCollapsed,
  pagesDrawerOpen,
  setPagesDrawerOpen,
  propertiesDrawerOpen,
  setPropertiesDrawerOpen,
  fitMode,
  onFitModeChange,
  onReplacePdfClick,
  replaceInputRef,
  handleReplaceFile,
  pdfSource,
  persistenceBaseline,
}: EditorWorkspaceWithTextInspectProps) {
  const { pageCount, status } = usePdfViewer()
  const {
    overlayObjects,
    imageIngestError,
    clearImageIngestError,
    getImageAsset,
  } = useEditorSession()
  const effectivePageCount =
    status === 'ready' && pageCount > 0 ? pageCount : document.pageCount
  const [workspaceRenderScale, setWorkspaceRenderScale] = useState(0)
  const [compareOpen, setCompareOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>({
    isDirty: false,
    lastSavedAt: null,
    lastError: null,
    isSaving: false,
  })
  const [propertiesTabKey, setPropertiesTabKey] =
    useState<PropertiesTabKey>('overlays')
  const saveProjectRef = useRef<(() => Promise<StorageResult<void>>) | null>(
    null,
  )

  const lastSavedPhrase = formatLastSavedAt(saveStatus.lastSavedAt)

  const saveStatusLabel =
    document.source !== 'user'
      ? 'Demo document'
      : saveStatus.isSaving
        ? 'Saving…'
        : saveStatus.lastError
          ? 'Save failed'
          : saveStatus.isDirty
            ? 'Unsaved changes'
            : lastSavedPhrase
              ? `Saved ${lastSavedPhrase}`
              : 'Not saved yet'

  const saveStatusTooltip =
    document.source !== 'user'
      ? 'Sample document — edits are not saved locally.'
      : saveStatus.lastError
        ? `${saveStatus.lastError} Projects stay on this device only; export a PDF for a portable copy.`
        : saveStatus.isDirty
          ? 'Changes are stored as a local draft in this browser. Use Save project when you want a completed save.'
          : lastSavedPhrase
            ? `Last saved ${lastSavedPhrase} on this device. Not backed up to the cloud.`
            : 'Save project stores overlays and view settings in IndexedDB on this device.'

  const saveStatusTone: 'neutral' | 'warning' | 'success' | 'error' =
    document.source !== 'user'
      ? 'neutral'
      : saveStatus.lastError
        ? 'error'
        : saveStatus.isDirty
          ? 'warning'
          : saveStatus.lastSavedAt
            ? 'success'
            : 'neutral'

  const handleSaveProject = useCallback((): void => {
    if (document.source !== 'user') {
      return
    }
    void saveProjectRef.current?.()
  }, [document.source])

  const openPdfTextPanel = useCallback((): void => {
    setPropertiesTabKey('pdf-text')
    setPropertiesCollapsed(false)
    if (layoutMode === 'mobile') {
      setPropertiesDrawerOpen(true)
    }
  }, [layoutMode, setPropertiesCollapsed, setPropertiesDrawerOpen])

  const handleFitToPage = useCallback((): void => {
    onFitModeChange('page')
  }, [onFitModeChange])

  const handleBackRequest = (): void => {
    if (document.source === 'user' && saveStatus.isDirty) {
      Modal.confirm({
        title: 'Discard unsaved changes?',
        content:
          'You have edits that may not be fully saved to local browser storage yet. Stay to keep editing, or leave and rely on Recover unsaved work when you reopen—only on this device. Export a PDF if you need a file outside the browser.',
        okText: 'Leave anyway',
        okType: 'danger',
        cancelText: 'Stay',
        onOk: onBack,
      })
      return
    }
    onBack()
  }

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (document.source === 'user' && saveStatus.isDirty) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [document.source, saveStatus.isDirty])

  return (
    <PdfTextInspectProvider
      activePageIndex={currentPage - 1}
      pageCount={effectivePageCount}
      onNavigateToPage={setActivePage}
    >
      <OcrSessionProvider activePageIndex={currentPage - 1}>
      <>
        <EditorWorkspaceChrome
          layoutMode={layoutMode}
          documentName={documentName}
          onDocumentNameChange={onDocumentNameChange}
          zoomPercent={zoomPercent}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onZoomReset={onZoomReset}
          fitMode={fitMode}
          onFitToPage={handleFitToPage}
          onBack={handleBackRequest}
          activePage={currentPage}
          pageCount={effectivePageCount}
          onPageChange={setActivePage}
          onOpenPagesPanel={() => setPagesDrawerOpen(true)}
          onOpenPropertiesPanel={() => {
            setPropertiesDrawerOpen(true)
            setPropertiesCollapsed(false)
          }}
          onReplacePdf={onReplacePdfClick}
          pdfSource={pdfSource}
          documentSource={document.source}
          onCompare={() => setCompareOpen(true)}
          saveStatusLabel={saveStatusLabel}
          saveStatusTone={saveStatusTone}
          saveStatusTooltip={saveStatusTooltip}
          onSaveProject={
            document.source === 'user' ? handleSaveProject : undefined
          }
          saveProjectDisabled={saveStatus.isSaving}
          isSavingProject={saveStatus.isSaving}
        />
        <EditorPersistenceHost
          documentId={document.id}
          documentName={documentName}
          pdfSource={pdfSource}
          enabled={document.source === 'user'}
          sessionBaseline={persistenceBaseline}
          activePage={currentPage}
          zoomPercent={zoomPercent}
          fitMode={fitMode}
          onSaveStatusChange={setSaveStatus}
          onSaveReady={(saveNow) => {
            saveProjectRef.current = saveNow
          }}
        />
        <DocumentComparisonModal
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          activePage={currentPage}
          pageCount={document.pageCount}
          onPageChange={setActivePage}
          zoomPercent={zoomPercent}
          fitMode={fitMode}
          overlayObjects={overlayObjects}
          getImageAsset={getImageAsset}
        />
      <EditorKeyboardHost />
      <input
        ref={replaceInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className={styles.hiddenInput}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void handleReplaceFile(file)
          }
          event.target.value = ''
        }}
      />

      <div className={styles.main}>
        {layoutMode === 'mobile' ? (
          <EditorLeftRail
            layoutMode={layoutMode}
            propertiesTabKey={propertiesTabKey}
            onOpenPdfTextPanel={openPdfTextPanel}
          />
        ) : null}
        <div className={styles.workspace}>
          {layoutMode !== 'mobile' ? (
            <EditorLeftRail
              layoutMode={layoutMode}
              propertiesTabKey={propertiesTabKey}
              onOpenPdfTextPanel={openPdfTextPanel}
            />
          ) : null}
          {showInlineSidebars ? (
            <PagesSidebar
              pageCount={document.pageCount}
              activePage={currentPage}
              onPageSelect={(page) => {
                setActivePage(page)
                setPagesDrawerOpen(false)
              }}
              collapsed={pagesCollapsed}
              onToggleCollapse={() => setPagesCollapsed((prev) => !prev)}
            />
          ) : null}
          <div className={styles.canvasColumn}>
            {imageIngestError ? (
              <Alert
                type="error"
                showIcon
                message={imageIngestError}
                closable
                onClose={clearImageIngestError}
                className={styles.inlineAlert}
              />
            ) : null}
            <WorkspacePreviewModeSwitch />
            <PdfWorkspace
              zoomPercent={zoomPercent}
              fitMode={fitMode}
              activePage={currentPage}
              documentSource={document.source}
              onReplacePdf={onReplacePdfClick}
              onRenderScaleChange={setWorkspaceRenderScale}
            />
          </div>
          {showInlineSidebars ? (
            <PropertiesSidebar
              collapsed={propertiesCollapsed}
              onToggleCollapse={() => setPropertiesCollapsed((prev) => !prev)}
              activePage={currentPage}
              renderScale={workspaceRenderScale}
              activeTabKey={propertiesTabKey}
              onTabChange={setPropertiesTabKey}
            />
          ) : null}
        </div>
        <EditorStatusBar
          activePage={currentPage}
          totalPages={effectivePageCount}
          zoomPercent={zoomPercent}
          propertiesTabKey={propertiesTabKey}
        />
      </div>

      {layoutMode === 'mobile' ? (
        <>
          <Drawer
            title="Pages"
            placement="left"
            open={pagesDrawerOpen}
            onClose={() => setPagesDrawerOpen(false)}
            width={280}
            destroyOnHidden
          >
            <PagesSidebar
              pageCount={document.pageCount}
              activePage={currentPage}
              onPageSelect={(page) => {
                setActivePage(page)
                setPagesDrawerOpen(false)
              }}
              collapsed={false}
              onToggleCollapse={() => setPagesDrawerOpen(false)}
            />
          </Drawer>
          <Drawer
            title="Properties"
            placement="right"
            open={propertiesDrawerOpen}
            onClose={() => setPropertiesDrawerOpen(false)}
            width={300}
            destroyOnHidden
          >
            <PropertiesSidebar
              collapsed={false}
              onToggleCollapse={() => setPropertiesDrawerOpen(false)}
              activePage={currentPage}
              renderScale={workspaceRenderScale}
              activeTabKey={propertiesTabKey}
              onTabChange={setPropertiesTabKey}
            />
          </Drawer>
        </>
      ) : null}
      </>
      </OcrSessionProvider>
    </PdfTextInspectProvider>
  )
}
