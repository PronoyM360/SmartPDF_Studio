import { useOcrSession } from '@/features/ocr/OcrSessionContext'
import { PageRegionDrawLayer } from '@/features/pdf-editor/PageRegionDrawLayer'

interface OcrRegionSelectLayerProps {
  pageNumber: number
  pageIndex: number
  renderScale: number
}

export function OcrRegionSelectLayer({
  pageNumber,
  pageIndex,
  renderScale,
}: OcrRegionSelectLayerProps) {
  const { regionSelectActive, setRegionSelectActive, runOcrOnRegion, job } =
    useOcrSession()

  if (!regionSelectActive) {
    return null
  }

  const busy =
    job.status === 'rendering' ||
    job.status === 'loading-worker' ||
    job.status === 'recognizing'

  return (
    <PageRegionDrawLayer
      pageNumber={pageNumber}
      pageIndex={pageIndex}
      renderScale={renderScale}
      disabled={busy}
      ariaLabel="OCR region selection"
      onRegionComplete={(pdfBounds) => {
        setRegionSelectActive(false)
        runOcrOnRegion(pdfBounds)
      }}
    />
  )
}
