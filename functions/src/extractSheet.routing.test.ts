import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  analyzePdfPage: vi.fn(),
  parseDigitalSongSelectPage: vi.fn(),
  generateContent: vi.fn(),
  constructed: vi.fn(),
}))

vi.mock('./pdfSheetAnalysis.js', () => ({
  analyzePdfPage: mocks.analyzePdfPage,
  parseDigitalSongSelectPage: mocks.parseDigitalSongSelectPage,
}))

vi.mock('@google/genai', () => ({
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER' },
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
    constructor() { mocks.constructed() }
  },
}))

import { extractSongsWithGemini } from './extractSheet.js'

const rawSong = {
  title: 'Digital Song',
  sections: [{ type: 'Verse' as const, label: 'Verse 1', lines: [{ kind: 'lyric' as const, words: [{ text: 'Hello', x0: 0, x1: 10 }] }] }],
}

describe('deterministic PDF routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GEMINI_API_KEY
  })

  it('imports a digital PDF without constructing a Gemini client or requiring a key', async () => {
    mocks.analyzePdfPage.mockResolvedValue({ classification: 'digital', rows: [], diagnostics: [], hasImages: false })
    mocks.parseDigitalSongSelectPage.mockReturnValue({ song: rawSong })

    const songs = await extractSongsWithGemini([{ mimeType: 'application/pdf', base64Data: 'AQ==' }])

    expect(songs.map((song) => song.title)).toEqual(['Digital Song'])
    expect(mocks.constructed).not.toHaveBeenCalled()
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })

  it('identifies the exact fallback page when a Gemini key is required', async () => {
    mocks.analyzePdfPage.mockResolvedValue({ classification: 'scanned', rows: [], diagnostics: ['0 meaningful text characters'], hasImages: true })
    mocks.parseDigitalSongSelectPage.mockReturnValue({ reason: 'Page is scanned' })

    await expect(extractSongsWithGemini([{ mimeType: 'application/pdf', base64Data: 'Ag==' }]))
      .rejects.toThrow('Gemini is required for page 1 (Page is scanned)')
    expect(mocks.constructed).not.toHaveBeenCalled()
  })
})
