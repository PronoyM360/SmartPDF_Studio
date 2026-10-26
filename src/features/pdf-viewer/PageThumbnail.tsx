import { useEffect, useRef, useState } from 'react'
import { renderPdfPage } from '@/lib/pdf'
import { usePdfViewer } from './PdfViewerContext'
import styles from './PageThumbnail.module.css'

const THUMBNAIL_MAX_WIDTH = 120

interface PageThumbnailProps {
  pageNumber: number
  selected: boolean
  onSelect: () => void
}

export function PageThumbnail({
  pageNumber,
  selected,
  onSelect,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rootRef = useRef<HTMLButtonElement>(null)
  const { pdf, renderGeneration, status, getPageMeta } = usePdfViewer()
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    const node = rootRef.current
    if (!node) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          setVisible(true)
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setRendered(false)
  }, [renderGeneration, pageNumber])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || status !== 'ready' || !visible || rendered) {
      return
    }

    let cancelled = false
    let renderTask: ReturnType<typeof renderPdfPage> | null = null

    void (async () => {
      try {
        const meta = await getPageMeta(pageNumber - 1)
        if (cancelled) {
          return
        }
        const scale = THUMBNAIL_MAX_WIDTH / meta.width
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          return
        }
        renderTask = renderPdfPage({
          page,
          canvas,
          scale,
          devicePixelRatio: 1,
        })
        await renderTask.promise
        if (!cancelled) {
          setRendered(true)
        }
      } catch {
        // Thumbnail render failures stay as placeholders.
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [
    pdf,
    pageNumber,
    visible,
    rendered,
    renderGeneration,
    status,
    getPageMeta,
  ])

  return (
    <button
      ref={rootRef}
      type="button"
      className={selected ? styles.thumbActive : styles.thumb}
      onClick={onSelect}
      aria-label={`Page ${pageNumber}`}
      aria-current={selected ? 'page' : undefined}
    >
      <span className={styles.preview}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      </span>
      <span className={styles.label}>{pageNumber}</span>
    </button>
  )
}
