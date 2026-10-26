import type { PageViewport } from 'pdfjs-dist'
import { useEffect, useState } from 'react'
import { usePdfViewer } from '@/features/pdf-viewer/PdfViewerContext'

export function usePageViewport(
  pageNumber: number,
  renderScale: number,
): PageViewport | null {
  const { pdf, renderGeneration, status } = usePdfViewer()
  const [viewport, setViewport] = useState<PageViewport | null>(null)

  useEffect(() => {
    if (!pdf || status !== 'ready' || renderScale <= 0) {
      setViewport(null)
      return
    }

    let cancelled = false
    void pdf.getPage(pageNumber).then((page) => {
      if (!cancelled) {
        setViewport(page.getViewport({ scale: renderScale }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, renderScale, renderGeneration, status])

  return viewport
}
