import { createCanvas } from '@napi-rs/canvas'

/** Renders page one of a base64 PDF to a white-backed PNG scaled to `targetWidth` pixels wide. */
export async function renderPdfPageToPng(base64Pdf: string, targetWidth = 1600): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = Uint8Array.from(Buffer.from(base64Pdf, 'base64'))
  const document = await pdfjs.getDocument({ data } as Parameters<typeof pdfjs.getDocument>[0]).promise
  try {
    // A fully blank document yields a page count of zero, so getPage(1) would throw an opaque error.
    if (document.numPages < 1) {
      throw new Error('Could not render PDF page as an image: the PDF has no pages')
    }

    const page = await document.getPage(1)
    const unscaled = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: targetWidth / unscaled.width })
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    const renderParams = { canvas, canvasContext: context, viewport } as unknown as Parameters<
      typeof page.render
    >[0]
    await page.render(renderParams).promise
    return canvas.toBuffer('image/png').toString('base64')
  } finally {
    await document.destroy()
  }
}
