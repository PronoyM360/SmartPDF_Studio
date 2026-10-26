import { useEffect } from 'react'
import { useEditorSession } from '@/features/pdf-editor/EditorSessionContext'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  return target.isContentEditable
}

export function useEditorKeyboard(): void {
  const {
    selectedObjectId,
    selectObject,
    deleteSelectedObject,
    editingObjectId,
    setEditingObjectId,
    setMaskEyedropperActive,
    canUndo,
    canRedo,
    undo,
    redo,
    setActiveToolId,
    activeToolId,
    getSelectedObject,
  } = useEditorSession()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return
      }

      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        if (canUndo) {
          undo()
          event.preventDefault()
        }
        return
      }
      if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        if (canRedo) {
          redo()
          event.preventDefault()
        }
        return
      }

      if (!mod && !event.altKey) {
        const key = event.key.toLowerCase()
        if (key === 'v') {
          setActiveToolId('select')
          event.preventDefault()
          return
        }
        if (key === 'h') {
          setActiveToolId('pan')
          event.preventDefault()
          return
        }
        if (key === 't') {
          setActiveToolId('text')
          selectObject(null)
          event.preventDefault()
          return
        }
        if (key === 'm') {
          setActiveToolId('highlight')
          selectObject(null)
          event.preventDefault()
          return
        }
        if (key === 'i') {
          setActiveToolId('image')
          selectObject(null)
          event.preventDefault()
          return
        }
      }

      if (
        !mod &&
        event.key === 'Enter' &&
        activeToolId === 'select' &&
        selectedObjectId &&
        !editingObjectId
      ) {
        const selected = getSelectedObject()
        if (selected?.kind === 'text') {
          setEditingObjectId(selected.id)
          event.preventDefault()
        }
      }

      if (event.key === 'Escape') {
        if (editingObjectId) {
          setEditingObjectId(null)
          event.preventDefault()
          return
        }
        setMaskEyedropperActive(false)
        if (selectedObjectId) {
          selectObject(null)
          event.preventDefault()
        }
        return
      }

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedObjectId &&
        activeToolId === 'select'
      ) {
        deleteSelectedObject()
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedObjectId,
    selectObject,
    deleteSelectedObject,
    editingObjectId,
    setEditingObjectId,
    setMaskEyedropperActive,
    canUndo,
    canRedo,
    undo,
    redo,
    setActiveToolId,
    activeToolId,
    getSelectedObject,
  ])
}
