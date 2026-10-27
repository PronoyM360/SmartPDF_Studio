import { useEffect } from 'react'
import { PageRegionDrawLayer } from '@/features/pdf-editor/PageRegionDrawLayer'
import { useDocumentSections } from '@/features/sections/DocumentSectionsContext'

interface SectionRegionSelectLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

export function SectionRegionSelectLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: SectionRegionSelectLayerProps) {
  const { manualSelectActive, setManualSelectActive, addManualSection } =
    useDocumentSections()

  useEffect(() => {
    if (!manualSelectActive) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setManualSelectActive(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [manualSelectActive, setManualSelectActive])

  if (!manualSelectActive) {
    return null
  }

  return (
    <PageRegionDrawLayer
      pageNumber={pageNumber}
      pageIndex={pageIndex}
      renderScale={renderScale}
      ariaLabel="Draw a section region"
      onRegionComplete={(pdfBounds) => addManualSection(pageIndex, pdfBounds)}
    />
  )
}
