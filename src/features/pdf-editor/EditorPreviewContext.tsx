import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'

export type WorkspacePreviewMode = 'edited' | 'original' | 'side-by-side'

export interface PendingTextReplacementPreview {
  readonly pageIndex: number
  readonly originalText: string
  readonly replacementText: string
  readonly plan: TextReplacementPlan
}

interface EditorPreviewContextValue {
  previewMode: WorkspacePreviewMode
  setPreviewMode: (mode: WorkspacePreviewMode) => void
  pendingTextReplacement: PendingTextReplacementPreview | null
  setPendingTextReplacement: (value: PendingTextReplacementPreview | null) => void
}

const EditorPreviewContext = createContext<EditorPreviewContextValue | null>(null)

export function EditorPreviewProvider({ children }: { children: ReactNode }) {
  const [previewMode, setPreviewMode] = useState<WorkspacePreviewMode>('edited')
  const [pendingTextReplacement, setPendingTextReplacement] =
    useState<PendingTextReplacementPreview | null>(null)

  const value = useMemo(
    () => ({
      previewMode,
      setPreviewMode,
      pendingTextReplacement,
      setPendingTextReplacement,
    }),
    [previewMode, pendingTextReplacement],
  )

  return (
    <EditorPreviewContext.Provider value={value}>
      {children}
    </EditorPreviewContext.Provider>
  )
}

export function useEditorPreview(): EditorPreviewContextValue {
  const context = useContext(EditorPreviewContext)
  if (!context) {
    throw new Error('useEditorPreview must be used within EditorPreviewProvider')
  }
  return context
}
