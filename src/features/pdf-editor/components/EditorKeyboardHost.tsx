import { useEditorKeyboard } from '@/features/pdf-editor/hooks/useEditorKeyboard'

/** Mounts global editor keyboard handlers (Escape, Delete). */
export function EditorKeyboardHost() {
  useEditorKeyboard()
  return null
}
