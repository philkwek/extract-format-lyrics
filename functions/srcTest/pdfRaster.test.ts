import { describe, expect, it } from 'vitest'
import { renderPdfPageToPng } from '../src/pdfRaster.js'

const stream = (content: string) =>
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`

function buildPdf(objects: string[]): Buffer {
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** A 200x100 page with one filled rectangle, so the raster has visible ink. */
const onePagePdf = () =>
  buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>',
    stream('0 0 1 rg\n10 10 180 80 re\nf'),
  ])

const pngWidth = (png: Buffer) => png.readUInt32BE(16)

describe('PDF page rasterizing', () => {
  it('renders page one as a PNG at the requested pixel width', async () => {
    const base64 = await renderPdfPageToPng(onePagePdf().toString('base64'), 400)
    const png = Buffer.from(base64, 'base64')

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(pngWidth(png)).toBe(400)
  })

  it('rejects input that is not a PDF', async () => {
    const notAPdf = Buffer.from('this is not a pdf').toString('base64')
    await expect(renderPdfPageToPng(notAPdf)).rejects.toThrow()
  })
})
