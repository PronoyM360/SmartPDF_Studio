import { useState } from 'react'
import { useDocumentLibrary } from '@/app/DocumentLibraryContext'
import { DashboardView } from '@/features/dashboard/DashboardView'
import { EditorWorkspace } from '@/features/pdf-editor/EditorWorkspace'
import type { DocumentRecord } from '@/types/documentRecord'

type AppRoute =
  | { view: 'dashboard' }
  | { view: 'editor'; documentId: string }

export function AppShell() {
  const { getDocumentById } = useDocumentLibrary()
  const [route, setRoute] = useState<AppRoute>({ view: 'dashboard' })

  const openDocument = (document: DocumentRecord): void => {
    setRoute({ view: 'editor', documentId: document.id })
  }

  const activeDocument =
    route.view === 'editor' ? getDocumentById(route.documentId) : undefined

  if (route.view === 'editor' && activeDocument) {
    return (
      <EditorWorkspace
        document={activeDocument}
        onBack={() => setRoute({ view: 'dashboard' })}
        onDocumentReplaced={openDocument}
      />
    )
  }

  return <DashboardView onOpenDocument={openDocument} />
}
