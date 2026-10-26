import { PdfUserFacingError } from '@/lib/pdf'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg'])
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg']

export async function validateImageFile(file: File): Promise<void> {
  if (!file || file.size === 0) {
    throw new PdfUserFacingError('The image file is empty.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new PdfUserFacingError('Images must be 15 MB or smaller.')
  }

  const lowerName = file.name.toLowerCase()
  const hasAllowedExt = ALLOWED_EXT.some((ext) => lowerName.endsWith(ext))
  if (!hasAllowedExt) {
    throw new PdfUserFacingError('Only PNG and JPEG images are supported.')
  }

  if (file.type && !ALLOWED_MIME.has(file.type.toLowerCase())) {
    throw new PdfUserFacingError('Only PNG and JPEG images are supported.')
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (!isPng && !isJpeg) {
    throw new PdfUserFacingError('The file does not appear to be a valid PNG or JPEG.')
  }
}

export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const blobUrl = URL.createObjectURL(file)
  try {
    const image = await loadHtmlImage(blobUrl)
    return { width: image.naturalWidth, height: image.naturalHeight }
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not decode image.'))
    image.src = src
  })
}
