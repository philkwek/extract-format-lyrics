import { describe, it, expect, vi } from 'vitest'
import { scrapeSingleUrl, generateSongId } from './scraper.js'

describe('generateSongId', () => {
  it('generates a stable 16-char hex hash', () => {
    const id1 = generateSongId('https://pnwchords.com/song1')
    const id2 = generateSongId('https://pnwchords.com/song1')
    const id3 = generateSongId('https://pnwchords.com/song2')

    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
    expect(id1.length).toBe(16)
  })
})

describe('scrapeSingleUrl', () => {
  it('extracts and structures a song from mocked safeFetch', async () => {
    const mockHtml = `
      <html>
        <head><title>Test Song - Test Artist</title></head>
        <body>
          <h1 class="page-title">Test Song – Test Artist</h1>
          <pre data-key="D">
[Verse 1]
D       G
Line of music
A       D
Second line
          </pre>
        </body>
      </html>
    `

    const mockFetch = vi.fn().mockResolvedValue({
      text: mockHtml,
      finalUrl: 'https://pnwchords.com/test-song',
    })

    const song = await scrapeSingleUrl('https://pnwchords.com/test-song', mockFetch as unknown as typeof safeFetchHtml)

    expect(song.title).toBe('Test Song')
    expect(song.artist).toBe('Test Artist')
    expect(song.originalKey).toBe('D')
    expect(song.sections.length).toBe(1)
    expect(song.sections[0].type).toBe('Verse')
    expect(song.simplifiedSections).toBeUndefined()
    expect(song.simplifiedSource).toBeUndefined()
  })

  it('fetches and attaches simplifiedSections with source official when available on ultimate-guitar', async () => {
    const ugHtmlNormal = `
      <div class="js-store" data-content="${JSON.stringify({
        store: {
          page: {
            data: {
              tab: { song_name: 'UG Song', artist_name: 'UG Artist' },
              tab_view: {
                meta: { tonality: 'G' },
                is_simplify_available: true,
                wiki_tab: { content: '[Verse 1]\nGadd9   Cmaj7\nSome complex chords' },
              },
            },
          },
        },
      }).replace(/"/g, '&quot;')}"></div>
    `

    const ugHtmlSimplified = `
      <div class="js-store" data-content="${JSON.stringify({
        store: {
          page: {
            data: {
              tab: { song_name: 'UG Song', artist_name: 'UG Artist' },
              tab_view: {
                meta: { tonality: 'G' },
                is_simplify_available: true,
                wiki_tab: { content: '[Verse 1]\nG       C\nSome simplified chords' },
              },
            },
          },
        },
      }).replace(/"/g, '&quot;')}"></div>
    `

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('simplified=1')) {
        return Promise.resolve({ text: ugHtmlSimplified, finalUrl: url })
      }
      return Promise.resolve({ text: ugHtmlNormal, finalUrl: url })
    })

    const song = await scrapeSingleUrl('https://tabs.ultimate-guitar.com/tab/ug-artist/ug-song-123', mockFetch as unknown as typeof safeFetchHtml)

    expect(song.title).toBe('UG Song')
    expect(song.artist).toBe('UG Artist')
    expect(song.originalKey).toBe('G')
    expect(song.sections).toBeDefined()
    expect(song.simplifiedSections).toBeDefined()
    expect(song.simplifiedSections?.length).toBe(1)
    expect(song.simplifiedSections?.[0].lines[0].chords?.[0].chord).toBe('G')
    expect(song.simplifiedSource).toBe('official')
  })

  it('generates algorithmic fallback when site has no official simplified chart and chords can be simplified', async () => {
    const mockHtml = `
      <html>
        <head><title>Complex Song - Worship Band</title></head>
        <body>
          <h1 class="page-title">Complex Song – Worship Band</h1>
          <pre data-key="D">
[Verse 1]
Dsus4   Gadd9   D/F#
Lift up your eyes
Bm7b5   A7      Dsus2
To the heavens
          </pre>
        </body>
      </html>
    `

    const mockFetch = vi.fn().mockResolvedValue({
      text: mockHtml,
      finalUrl: 'https://pnwchords.com/complex-song',
    })

    const song = await scrapeSingleUrl('https://pnwchords.com/complex-song', mockFetch as unknown as typeof safeFetchHtml)

    expect(song.simplifiedSource).toBe('algorithmic')
    expect(song.simplifiedSections).toBeDefined()
    expect(song.simplifiedSections?.length).toBe(1)

    const line0 = song.simplifiedSections?.[0].lines[0]
    expect(line0?.kind).toBe('lyric')
    if (line0?.kind === 'lyric') {
      expect(line0.chords.map((c) => c.chord)).toEqual(['D', 'G', 'D'])
    }

    const line1 = song.simplifiedSections?.[0].lines[1]
    expect(line1?.kind).toBe('lyric')
    if (line1?.kind === 'lyric') {
      expect(line1.chords.map((c) => c.chord)).toEqual(['Bm', 'A', 'D'])
    }

    // Original sections remain untouched
    const origLine0 = song.sections[0].lines[0]
    if (origLine0.kind === 'lyric') {
      expect(origLine0.chords.map((c) => c.chord)).toEqual(['Dsus4', 'Gadd9', 'D/F#'])
    }
  })
})

