import { message, Modal } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [lastExport, setLastExport] = useState<{
    source: PdfSource
    bytes: Uint8Array
    report: ExportQualityReport
    verified: boolean
  } | null>(null)
  const exportingRef = useRef(false)
  const revokeDownloadRef = useRef<(() => void) | null>(null)
  // An export of a previous document must not be offered for comparison.
  const currentExport = lastExport && lastExport.source === source ? lastExport : null

  useEffect(() => {
    return () => {
      revokeDownloadRef.current?.()
      revokeDownloadRef.current = null
    }
  }, [])

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
        revokeDownloadRef.current?.()
        revokeDownloadRef.current = downloadPdfBytes(bytes, filename)
        const failed = report.checks.filter((check) => check.status === 'failed').length
        const warnings = report.checks.filter((check) => check.status === 'warning').length
        if (source) {
          setLastExport({ source, bytes: bytes.slice(), report, verified: failed === 0 })
        }

        if (failed === 0 && warnings === 0) {
          message.success(`Download started: ${filename} (edited copy)`, 4)
        } else if (failed === 0) {
          message.warning(
            `Download started: ${filename}. Review export warnings and compare with the original before sharing.`,
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
      } catch (cause) {
        message.error(
          cause instanceof Error ? `Download failed: ${cause.message}` : 'Download failed.',
        )
      } finally {
        exportingRef.current = false
        setStatus('idle')
      }
    },
    [documentName, source],
  )

  return {
    openExportQualityCheck,
    closeExportQualityCheck,
    qualityCheckOpen,
    completeDownload,
    isExporting: status === 'exporting',
    lastExportedBytes: currentExport?.bytes ?? null,
    lastExportVerified: currentExport?.verified ?? false,
    lastQualityReport: currentExport?.report ?? null,
    hasExportCompare: currentExport !== null,
    overlayObjects,
    getImageBytes,
    source,
  }
}
