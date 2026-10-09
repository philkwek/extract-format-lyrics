export interface PreparedSheetFile {
  mimeType: string
  base64Data: string
  fileName: string
  previewUrl: string
}

/**
 * Converts a Blob or File to a raw base64 string (without the data URL prefix).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Format is "data:mime/type;base64,XXXX..." -> extract the XXXX...
      const base64 = result.split(',')[1] || ''
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Resizes an image file if it exceeds maxDimension and compresses it as JPEG.
 */
export async function optimizeImageFile(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<{ mimeType: string; base64Data: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      let { width, height } = img

      // Downscale if larger than max dimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width)
          width = maxDimension
        } else {
          width = Math.round((width * maxDimension) / height)
          height = maxDimension
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Failed to get 2D canvas context'))
        return
      }

      // Draw white background in case of transparent PNG
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        async (blob) => {
          URL.revokeObjectURL(objectUrl)
          if (!blob) {
            reject(new Error('Canvas blob conversion failed'))
            return
          }
          const base64Data = await blobToBase64(blob)
          const previewUrl = URL.createObjectURL(blob)
          resolve({
            mimeType: 'image/jpeg',
            base64Data,
            previewUrl,
          })
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Failed to load image: ${file.name}`))
    }

    img.src = objectUrl
  })
}

/**
 * Prepares user-selected PDF or image files for upload to the extraction endpoint.
 */
export async function prepareFilesForExtraction(files: File[]): Promise<PreparedSheetFile[]> {
  const prepared: PreparedSheetFile[] = []

  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const base64Data = await blobToBase64(file)
      const previewUrl = URL.createObjectURL(file)
      prepared.push({
        mimeType: 'application/pdf',
        base64Data,
        fileName: file.name,
        previewUrl,
      })
    } else if (file.type.startsWith('image/')) {
      const { mimeType, base64Data, previewUrl } = await optimizeImageFile(file)
      prepared.push({
        mimeType,
        base64Data,
        fileName: file.name,
        previewUrl,
      })
    } else {
      throw new Error(`Unsupported file type: ${file.name}. Only PDF and images are supported.`)
    }
  }

  return prepared
}
