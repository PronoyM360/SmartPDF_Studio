import { message, Modal } from 'antd'
import { useCallback, useRef, useState } from 'react'
import {
  buildExportFilename,
  downloadPdfBytes,
} from '@/lib/pdf/export/downloadPdf'
import type { ExportQualityReport } from '@/lib/pdf/export/exportQualityChecks'
import type { PdfSource } from '@/types'
import type { OverlayObject } from '@/types/overlayObjects'

export type ExportStatus = 'idle' | 'exporting'

interface UsePdfExportOptions {
  source: PdfSource | null
  documentName: string
  overlayObjects: readonly OverlayObject[]
  getImageBytes: (assetId: string) => Uint8Array | undefined
}

export function usePdfExport({
  source,
  documentName,
  overlayObjects,
  getImageBytes,
}: UsePdfExportOptions) {
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [qualityCheckOpen, setQualityCheckOpen] = useState(false)
  const [lastExportedBytes, setLastExportedBytes] = useState<Uint8Array | null>(
    null,
  )
  const [lastExportVerified, setLastExportVerified] = useState(false)
  const [lastQualityReport, setLastQualityReport] = useState<ExportQualityReport | null>(
    null,
  )
  const exportingRef = useRef(false)

  const openExportQualityCheck = useCallback((): void => {
    if (!source) {
      message.error('Upload a PDF in this session before exporting.')
      return
    }
    setQualityCheckOpen(true)
  }, [source])

  const closeExportQualityCheck = useCallback((): void => {
    setQualityCheckOpen(false)
  }, [])

  const completeDownload = useCallback(
    (bytes: Uint8Array, report: ExportQualityReport): void => {
      if (!report.canDownload) {
        message.error('Export is not ready — fix failed checks first.')
        return
      }

      exportingRef.current = true
      setStatus('exporting')
      try {
        const filename = buildExportFilename(documentName)
        downloadPdfBytes(bytes, filename)
        setLastExportedBytes(bytes.slice())
        setLastQualityReport(report)
        const failed = report.checks.filter((check) => check.status === 'failed').length
        const warnings = report.checks.filter((check) => check.status === 'warning').length
        setLastExportVerified(failed === 0)

        if (failed === 0 && warnings === 0) {
          message.success(`Download started: ${filename}`, 4)
        } else if (failed === 0) {
          message.warning(
            `Download started: ${filename}. Review export warnings and compare visually before sharing.`,
            6,
          )
        }

        const notes = report.checks
          .filter((check) => check.status === 'warning')
          .map((check) => check.detail)
        if (notes.length > 0) {
          Modal.info({
            title: 'Export notes',
            width: 520,
            content: (
              <>
                <p style={{ marginTop: 0 }}>
                  Automated checks do not guarantee identical rendering in every PDF
                  viewer. Use toolbar <strong>Download PDF</strong> — browser Print
                  (Ctrl+P) does not include your overlays. If numbers look doubled,
                  expand the mask to fully cover the original text and set opacity to
                  100%.
                </p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {notes.slice(0, 6).map((note) => (
                    <li key={note} style={{ marginBottom: 6 }}>
                      {note}
                    </li>
                  ))}
                </ul>
              </>
            ),
          })
        }
      } finally {
        exportingRef.current = false
        setStatus('idle')
      }
    },
    [documentName],
  )

  return {
    openExportQualityCheck,
    closeExportQualityCheck,
    qualityCheckOpen,
    completeDownload,
    isExporting: status === 'exporting',
    lastExportedBytes,
    lastExportVerified,
    lastQualityReport,
    hasExportCompare: lastExportedBytes !== null,
    overlayObjects,
    getImageBytes,
    source,
  }
}
