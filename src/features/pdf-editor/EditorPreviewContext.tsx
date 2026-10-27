import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { TextReplacementPlan } from '@/lib/pdf/buildTextReplacementPlan'
import type { PageRect } from '@/types'

export type WorkspacePreviewMode = 'edited' | 'original' | 'side-by-side'

export interface PendingTextReplacementPreview {
  readonly pageIndex: number
  readonly originalText: string
  readonly replacementText: string
  readonly plan: TextReplacementPlan
  /** Reconstructed background shown instead of the flat mask (object URL + PDF bounds). */
  readonly backgroundPatch?: { readonly url: string; readonly bounds: PageRect } | null
}

interface EditorPreviewContextValue {
  previewMode: WorkspacePreviewMode
  setPreviewMode: (mode: WorkspacePreviewMode) => void
  pendingTextReplacement: PendingTextReplacementPreview | null
  setPendingTextReplacement: (value: PendingTextReplacementPreview | null) => void
  /** Tracked change outlined in every view (see `buildTrackedChanges`). */
  focusedChangeId: string | null
  setFocusedChangeId: (id: string | null) => void
  /** Bumps when the user resets the comparison view (scroll back to the top). */
  viewResetToken: number
  requestViewReset: () => void
}

const EditorPreviewContext = createContext<EditorPreviewContextValue | null>(null)

export function EditorPreviewProvider({ children }: { children: ReactNode }) {
  const [previewMode, setPreviewMode] = useState<WorkspacePreviewMode>('edited')
  const [pendingTextReplacement, setPendingTextReplacement] =
    useState<PendingTextReplacementPreview | null>(null)
  const [focusedChangeId, setFocusedChangeId] = useState<string | null>(null)
  const [viewResetToken, setViewResetToken] = useState(0)
  const requestViewReset = useCallback(() => setViewResetToken((value) => value + 1), [])

  const value = useMemo(
    () => ({
      previewMode,
      setPreviewMode,
      pendingTextReplacement,
      setPendingTextReplacement,
      focusedChangeId,
      setFocusedChangeId,
      viewResetToken,
      requestViewReset,
    }),
    [previewMode, pendingTextReplacement, focusedChangeId, viewResetToken, requestViewReset],
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
