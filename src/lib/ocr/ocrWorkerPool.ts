import type { OcrLanguagePackId } from '@/types/ocr'
import { getOcrLanguagePack } from '@/lib/ocr/languages'

type LoggerFn = (progress: number, status: string) => void

interface WorkerHandle {
  terminate: () => Promise<void>
  recognize: (image: HTMLCanvasElement) => Promise<import('tesseract.js').Page>
}

let activeWorker: WorkerHandle | null = null
let activeLanguage: OcrLanguagePackId | null = null

async function createOcrWorker(
  languageId: OcrLanguagePackId,
  onLog: LoggerFn,
): Promise<WorkerHandle> {
  const pack = getOcrLanguagePack(languageId)
  if (!pack.available) {
    throw new Error(pack.availabilityNote ?? `Language "${pack.label}" is not available.`)
  }

  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(pack.tesseractCode, undefined, {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onLog(message.progress, message.status)
      } else if (message.status) {
        onLog(message.progress, message.status)
      }
    },
  })

  return {
    async recognize(image) {
      const result = await worker.recognize(image, {}, { blocks: true, text: true })
      return result.data
    },
    async terminate() {
      await worker.terminate()
    },
  }
}

export async function acquireOcrWorker(
  languageId: OcrLanguagePackId,
  onLog: LoggerFn,
): Promise<WorkerHandle> {
  if (activeWorker && activeLanguage === languageId) {
    return activeWorker
  }
  await releaseOcrWorker()
  activeWorker = await createOcrWorker(languageId, onLog)
  activeLanguage = languageId
  return activeWorker
}

export async function releaseOcrWorker(): Promise<void> {
  if (activeWorker) {
    await activeWorker.terminate()
    activeWorker = null
    activeLanguage = null
  }
}

export async function cancelOcrWorker(): Promise<void> {
  await releaseOcrWorker()
}
