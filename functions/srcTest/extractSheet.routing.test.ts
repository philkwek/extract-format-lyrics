import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzePdfPage: vi.fn(),
  parseDigitalSongSelectPage: vi.fn(),
  renderPdfPageToPng: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../src/pdfSheetAnalysis.js', () => ({
  analyzePdfPage: mocks.analyzePdfPage,
  parseDigitalSongSelectPage: mocks.parseDigitalSongSelectPage,
}))

vi.mock('../src/pdfRaster.js', () => ({ renderPdfPageToPng: mocks.renderPdfPageToPng }))

import { extractSongsFromUpload } from '../src/extractSheet.js'

const rawSong = {
  title: 'Digital Song',
  sections: [
    {
      type: 'Verse' as const,
      label: 'Verse 1',
      lines: [{ kind: 'lyric' as const, words: [{ text: 'Hello', x0: 0, x1: 10 }] }],
    },
  ],
}

const scannedSong = {
  songs: [
    {
      title: 'Demo Scan Song',
      sections: [
        {
          type: 'Verse',
          label: 'Verse 1',
          lines: [
            {
              kind: 'lyric',
              words: [
                { text: 'Morning', x0: 0, x1: 60 },
                { text: 'light', x0: 70, x1: 120 },
              ],
              positionedChords: [{ chord: 'A', x0: 0, x1: 20 }],
            },
          ],
        },
      ],
    },
  ],
}

const jsonResponse = (content: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
})

const scannedPage = {
  classification: 'scanned',
  rows: [],
  diagnostics: ['0 meaningful text characters'],
  hasImages: true,
}

const envKeys = ['SOCLAAS_API_KEY', 'SOCLAAS_MODEL', 'SOCLAAS_BASE_URL'] as const
const originalEnv = envKeys.map((key) => [key, process.env[key]] as const)

describe('sheet extraction routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    for (const key of envKeys) delete process.env[key]
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('imports a digital PDF without calling the vision model or requiring a key', async () => {
    mocks.analyzePdfPage.mockResolvedValue({
      classification: 'digital',
      rows: [],
      diagnostics: [],
      hasImages: false,
    })
    mocks.parseDigitalSongSelectPage.mockReturnValue({ song: rawSong })

    const songs = await extractSongsFromUpload([{ mimeType: 'application/pdf', base64Data: 'AQ==' }])

    expect(songs.map((song) => song.title)).toEqual(['Digital Song'])
    expect(mocks.renderPdfPageToPng).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('identifies the exact fallback page when a scan needs the reader key', async () => {
    mocks.analyzePdfPage.mockResolvedValue(scannedPage)
    mocks.parseDigitalSongSelectPage.mockReturnValue({ reason: 'Page is scanned' })

    await expect(
      extractSongsFromUpload([{ mimeType: 'application/pdf', base64Data: 'Ag==' }]),
    ).rejects.toThrow(
      'Scanned pages need the SoClaaS reader: page 1 (Page is scanned). Ask the site owner to set SOCLAAS_API_KEY, or upload a selectable-text PDF.',
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('renders a scanned PDF page to PNG and asks for a JSON-schema chat reply', async () => {
    process.env.SOCLAAS_API_KEY = 'test-key'
    mocks.analyzePdfPage.mockResolvedValue(scannedPage)
    mocks.parseDigitalSongSelectPage.mockReturnValue({ reason: 'Page is scanned' })
    mocks.renderPdfPageToPng.mockResolvedValue('UE5H')
    mocks.fetch.mockResolvedValue(jsonResponse(scannedSong))

    const songs = await extractSongsFromUpload([{ mimeType: 'application/pdf', base64Data: 'Ag==' }])

    expect(songs.map((song) => song.title)).toEqual(['Demo Scan Song'])
    expect(mocks.renderPdfPageToPng).toHaveBeenCalledWith('Ag==')

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://soclaas-api.comp.nus.edu.sg/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen3-vl:32b')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,UE5H' } },
      { type: 'text', text: expect.any(String) },
    ])
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'songs', strict: true },
    })
    // The reader skips optional fields, which drops every chord above a lyric.
    const lineSchema =
      body.response_format.json_schema.schema.properties.songs.items.properties.sections.items
        .properties.lines.items
    expect(lineSchema.required).toEqual(['kind', 'words', 'positionedChords', 'content'])
  })

  it('fails with the status code when the reader rejects the request', async () => {
    process.env.SOCLAAS_API_KEY = 'test-key'
    mocks.analyzePdfPage.mockResolvedValue(scannedPage)
    mocks.parseDigitalSongSelectPage.mockReturnValue({ reason: 'Page is scanned' })
    mocks.renderPdfPageToPng.mockResolvedValue('UE5H')
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream unavailable',
    })

    await expect(
      extractSongsFromUpload([{ mimeType: 'application/pdf', base64Data: 'Ag==' }]),
    ).rejects.toThrow('status 502')
  })
})
