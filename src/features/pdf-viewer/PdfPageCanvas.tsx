import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Spin } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { renderPdfPage } from '@/lib/pdf'
import { usePdfViewer } from './PdfViewerContext'
import styles from './PdfPageCanvas.module.css'

interface PdfPageCanvasProps {
  pageNumber: number
  scale: number
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void
  /** Render from an alternate open document (e.g. last export) instead of the editor PDF. */
  pdfDocument?: PDFDocumentProxy | null
  renderKey?: number
  ariaLabel?: string
}

export function PdfPageCanvas({
  pageNumber,
  scale,
  onCanvasReady,
  pdfDocument,
  renderKey,
  ariaLabel,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewer = usePdfViewer()
  const pdf = pdfDocument ?? viewer.pdf
  const generation = renderKey ?? viewer.renderGeneration
  const ready = pdfDocument ? Boolean(pdfDocument) : viewer.status === 'ready'
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || !ready || scale <= 0) {
      return
    }

    let cancelled = false
    let renderTask: ReturnType<typeof renderPdfPage> | null = null

    setRendering(true)

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          return
        }
        renderTask = renderPdfPage({ page, canvas, scale })
        await renderTask.promise
        if (!cancelled) {
          onCanvasReady?.(canvas)
        }
      } catch {
        if (!cancelled) {
          const context = canvas.getContext('2d')
          context?.clearRect(0, 0, canvas.width, canvas.height)
        }
      } finally {
        if (!cancelled) {
          setRendering(false)
        }
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      setRendering(false)
      onCanvasReady?.(null)
    }
  }, [pdf, pageNumber, scale, generation, ready, onCanvasReady])

  return (
    <div className={styles.frame}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        aria-label={ariaLabel ?? `PDF page ${pageNumber}`}
      />
      {rendering ? (
        <div className={styles.overlay} aria-hidden>
          <Spin size="small" />
        </div>
      ) : null}
    </div>
  )
}
