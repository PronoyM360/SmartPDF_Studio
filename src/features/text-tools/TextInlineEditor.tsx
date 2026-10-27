import { useEffect, useRef } from 'react'
import { pdfRectToScreenBounds } from '@/lib/pdf'
import { hexToRgbaCss } from '@/lib/pdf/export/colorUtils'
import type { PageDisplayTransform } from '@/lib/pdf'
import type { TextOverlayObject } from '@/types/textOverlay'
import styles from './TextInlineEditor.module.css'

interface TextInlineEditorProps {
  object: TextOverlayObject
  transform: PageDisplayTransform
  renderScale: number
  onCommit: (content: string) => void
  onCancel: () => void
}

export function TextInlineEditor({
  object,
  transform,
  renderScale,
  onCommit,
  onCancel,
}: TextInlineEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const screenRect = pdfRectToScreenBounds(transform, object.bounds)

  useEffect(() => {
    const node = textareaRef.current
    if (!node) {
      return
    }
    node.focus()
    node.select()
  }, [object.id])

  return (
    <textarea
      ref={textareaRef}
      className={styles.editor}
      style={{
        left: screenRect.x,
        top: screenRect.y,
        width: screenRect.width,
        height: screenRect.height,
        fontFamily: object.fontFamily,
        fontSize: `${object.fontSize * renderScale}px`,
        color: object.color,
        backgroundColor: object.backgroundColor
          ? hexToRgbaCss(object.backgroundColor, object.backgroundOpacity ?? 1)
          : undefined,
        textAlign: object.alignment,
      }}
      defaultValue={object.content}
      aria-label="Edit text overlay"
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}
