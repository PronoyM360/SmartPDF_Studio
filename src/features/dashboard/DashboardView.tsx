import { FileAddOutlined, FolderOpenOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Input, Modal, Select, Spin, Typography, Upload, message } from 'antd'
import type { UploadProps } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listRecoverableProjects } from '@/features/persistence/listRecoverableProjects'
import type { RecoverableProjectSummary } from '@/features/persistence/listRecoverableProjects'
import { formatLastSavedAt } from '@/lib/persistence/formatLastSaved'
import { useDocumentLibrary } from '@/app/DocumentLibraryContext'
import { AppHeader } from '@/components/layout/AppHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import type {
  DocumentRecord,
  DocumentSortDirection,
  DocumentSortKey,
} from '@/types/documentRecord'
import { PDF_ACCEPT_EXTENSION } from '@/lib/pdf'
import { DocumentList } from './DocumentList'
import styles from './DashboardView.module.css'

const { Title, Text, Paragraph } = Typography

interface DashboardViewProps {
  onOpenDocument: (document: DocumentRecord) => void
}

export function DashboardView({ onOpenDocument }: DashboardViewProps) {
  const {
    demoDocuments,
    userDocuments,
    loading,
    ingestError,
    clearIngestError,
    ingestFile,
    removeUserDocument,
    clearAllLocalData,
  } = useDocumentLibrary()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<DocumentSortKey>('lastEdited')
  const [sortDirection, setSortDirection] =
    useState<DocumentSortDirection>('desc')
  const [recoverable, setRecoverable] = useState<RecoverableProjectSummary[]>(
    [],
  )

  useEffect(() => {
    let cancelled = false
    void listRecoverableProjects(userDocuments).then((items) => {
      if (!cancelled) {
        setRecoverable(items)
      }
    })
    return () => {
      cancelled = true
    }
  }, [userDocuments])

  const handlePickFile = async (file: File): Promise<void> => {
    const record = await ingestFile(file)
    if (record) {
      message.success(`"${record.name}" is ready to view.`)
      onOpenDocument(record)
    }
  }

  const uploadProps: UploadProps = {
    accept: `application/pdf,${PDF_ACCEPT_EXTENSION}`,
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      void handlePickFile(file)
      return false
    },
  }

  const allDocuments = useMemo(
    () => [...userDocuments, ...demoDocuments],
    [userDocuments, demoDocuments],
  )

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase()
    let items = allDocuments
    if (query) {
      items = items.filter((doc) => doc.name.toLowerCase().includes(query))
    }
    const sorted = [...items].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortKey === 'pageCount') {
        cmp = a.pageCount - b.pageCount
      } else {
        cmp =
          new Date(a.lastEditedAt).getTime() -
          new Date(b.lastEditedAt).getTime()
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [allDocuments, search, sortKey, sortDirection])

  const confirmDelete = (document: DocumentRecord): void => {
    Modal.confirm({
      title: 'Delete this document?',
      content: `"${document.name}" will be removed from your recent uploads on this device.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: () => removeUserDocument(document.id),
    })
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <div className={styles.body}>
        <section className={styles.hero}>
          <div>
            <Title level={3} className={styles.heroTitle}>
              Your PDF workspace
            </Title>
            <Paragraph type="secondary" className={styles.heroText}>
              Uploads are stored in this browser: PDF bytes and editor overlays in
              IndexedDB, document list metadata in localStorage. Data stays on this
              device and is not shared with other apps or accounts.
            </Paragraph>
          </div>
          <div className={styles.heroActions}>
            <Upload {...uploadProps} disabled={loading}>
              <Button type="primary" icon={<FileAddOutlined />} loading={loading}>
                Upload PDF
              </Button>
            </Upload>
            <Button
              icon={<FolderOpenOutlined />}
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
            >
              Open PDF
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className={styles.hiddenInput}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void handlePickFile(file)
                }
                event.target.value = ''
              }}
            />
          </div>
        </section>

        {recoverable.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            className={styles.recoveryBanner}
            message="Recover unsaved work"
            description={
              <>
                {recoverable.map((item) => (
                  <div key={item.documentId} className={styles.recoveryRow}>
                    <Text>
                      <Text strong>{item.documentName}</Text>
                      {' — draft '}
                      {formatLastSavedAt(item.recoveryAt) ?? item.recoveryAt}
                      {item.savedAt ? (
                        <>
                          {' '}
                          (saved{' '}
                          {formatLastSavedAt(item.savedAt) ?? item.savedAt})
                        </>
                      ) : null}
                    </Text>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        const doc = userDocuments.find(
                          (entry) => entry.id === item.documentId,
                        )
                        if (doc) {
                          onOpenDocument(doc)
                        }
                      }}
                    >
                      Open project
                    </Button>
                  </div>
                ))}
                <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
                  Drafts live in this browser only. Opening the project offers to
                  restore newer unsaved edits.
                </Paragraph>
              </>
            }
          />
        ) : null}

        {ingestError ? (
          <div className={styles.errorBlock}>
            <ErrorState
              title="Could not open PDF"
              message={ingestError}
              onRetry={clearIngestError}
            />
          </div>
        ) : null}

        <section className={styles.recentSection} aria-labelledby="recent-docs">
          <div className={styles.recentHeader}>
            <div>
              <Title level={5} id="recent-docs" className={styles.sectionTitle}>
                Recent documents
              </Title>
              <Text type="secondary" className={styles.sectionHint}>
                Sample entries are labeled. User documents restore from local
                storage when you reopen them.
              </Text>
            </div>
            <div className={styles.controls}>
              <Input
                allowClear
                size="small"
                prefix={<SearchOutlined aria-hidden />}
                placeholder="Search by file name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search documents"
                className={styles.search}
              />
              <Select
                size="small"
                value={sortKey}
                onChange={setSortKey}
                aria-label="Sort documents by"
                options={[
                  { value: 'lastEdited', label: 'Last edited' },
                  { value: 'name', label: 'File name' },
                  { value: 'pageCount', label: 'Page count' },
                ]}
              />
              <Select
                size="small"
                value={sortDirection}
                onChange={setSortDirection}
                aria-label="Sort direction"
                options={[
                  { value: 'desc', label: 'Descending' },
                  { value: 'asc', label: 'Ascending' },
                ]}
              />
            </div>
          </div>

          {loading ? (
            <div className={styles.loading}>
              <Spin tip="Reading PDF metadata…" />
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className={styles.emptyPanel}>
              <EmptyState
                title={search ? 'No matching documents' : 'No documents yet'}
                description={
                  search
                    ? 'Try a different search term or clear the filter.'
                    : 'Upload a PDF or browse the sample documents once they match your search.'
                }
                action={
                  search ? (
                    <Button size="small" onClick={() => setSearch('')}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <DocumentList
              documents={filteredDocuments}
              onOpen={onOpenDocument}
              onDelete={confirmDelete}
            />
          )}
        </section>

        <section className={styles.privacySection}>
          <Title level={5}>Local data & privacy</Title>
          <Paragraph type="secondary" className={styles.privacyText}>
            SmartPDF Studio does not upload your PDFs to a server in this build.
            Clearing local data removes IndexedDB sessions and PDF copies plus the
            dashboard list. Export a PDF first if you need a file outside the browser.
          </Paragraph>
          <Button
            danger
            size="small"
            onClick={() => {
              Modal.confirm({
                title: 'Remove all local SmartPDF data?',
                content:
                  'This deletes stored PDFs, overlay edits, and upload metadata from this browser only.',
                okText: 'Remove local data',
                okType: 'danger',
                cancelText: 'Cancel',
                onOk: async () => {
                  const result = await clearAllLocalData()
                  if (result.ok) {
                    message.success(result.message)
                  } else {
                    message.error(result.message)
                  }
                },
              })
            }}
          >
            Clear all local data
          </Button>
        </section>
      </div>
    </div>
  )
}
