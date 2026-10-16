import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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

  it('determines originalKey from chords when scraped metadata key is incorrect', async () => {
    const mockHtml = `
      <html>
        <head><title>Wrong Key Song - Artist</title></head>
        <body>
          <h1 class="page-title">Wrong Key Song – Artist</h1>
          <pre data-key="C">
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
      finalUrl: 'https://pnwchords.com/wrong-key-song',
    })

    const song = await scrapeSingleUrl('https://pnwchords.com/wrong-key-song', mockFetch as unknown as typeof safeFetchHtml)

    // Even though data-key was "C", chord detection correctly infers "D"
    expect(song.originalKey).toBe('D')
  })
})



it('infers G for Heart of a Servant chart 1905600 despite C metadata', async () => {
  // Actual chord sequence from the linked chart, including its final IV chord.
  // Neutral lyric placeholders preserve the per-line annotations without copying lyrics.
  const verse = 'C D Am G D G C D Am G D G'.split(' ')
  const chorus = 'C C Am D D G C C Am Am D D G G C'.split(' ')
  const annotate = (chords: string[]) => chords.map((chord, i) => `[ch]${chord}[/ch]\nLyric line ${i}`).join('\n')
  const data = { store: { page: { data: {
    tab: { song_name: 'Heart of a Servant', artist_name: 'City Harvest Church' },
    tab_view: { meta: { tonality: 'C' }, wiki_tab: {
      content: 'Verse\n' + annotate(verse) + '\n[Chorus]\n' + annotate(chorus),
    } },
  } } } }
  const html = `<div class="js-store" data-content="${JSON.stringify(data).replace(/"/g, '&quot;')}"></div>`
  const url = 'https://tabs.ultimate-guitar.com/tab/city-harvest-church/heart-of-a-servant-chords-1905600'
  const fetcher = vi.fn().mockResolvedValue({ text: html, finalUrl: url })
  const song = await scrapeSingleUrl(url, fetcher)
  expect(song.originalKey).toBe('G')
  expect(song.sections.map(section => section.type)).toEqual(['Verse', 'Chorus'])
})


it('infers C for Fresh Fire chart 5088748 rather than its first Am chord', async () => {
  const chart: Array<{ label: string; chords: string[] }> = JSON.parse(
    readFileSync(new URL('./__fixtures__/fresh-fire-5088748.json', import.meta.url), 'utf8'),
  )
  // Neutral placeholders keep the source's line structure without storing lyrics.
  const content = chart.map(({ label, chords }, sectionIndex) => `[${label}]\n` +
    chords.map((chord, chordIndex) => `[ch]${chord}[/ch]\nLyric line ${sectionIndex} ${chordIndex}`).join('\n'),
  ).join('\n')
  const data = { store: { page: { data: {
    tab: { song_name: 'Fresh Fire', artist_name: 'The Belonging Co' },
    tab_view: { meta: { tonality: 'Am' }, wiki_tab: { content } },
  } } } }
  const html = `<div class="js-store" data-content="${JSON.stringify(data).replace(/"/g, '&quot;')}"></div>`
  const url = 'https://tabs.ultimate-guitar.com/tab/the-belonging-co/fresh-fire-chords-5088748'
  const fetcher = vi.fn().mockResolvedValue({ text: html, finalUrl: url })
  const song = await scrapeSingleUrl(url, fetcher)
  expect(song.originalKey).toBe('C')
  expect(song.sections[0].type).toBe('Intro')
  expect(song.sections[0].lines[0].kind).toBe('lyric')
})

describe('scraping major-family output policy', () => {
  const fetchSong = (metadata: string | null, content: string) => {
    const html = `<h1>Test Song – Artist</h1><pre${metadata === null ? '' : ` data-key="${metadata}"`}>${content}</pre>`
    const url = 'https://pnwchords.com/key-policy'
    return scrapeSingleUrl(url, vi.fn().mockResolvedValue({ text: html, finalUrl: url }))
  }

  it.each([
    ['Am', 'C'], ['C#m', 'E'], ['Dm', 'F'], ['F#m', 'A'], ['Bbm', 'Db'], ['G#m', 'B'],
    ['Eb minor', 'Gb'], ['F#', 'F#'], ['Gb', 'Gb'], ['A#', 'A#'],
  ])('normalizes metadata fallback %s to %s for a chordless chart', async (metadata, expected) => {
    expect((await fetchSong(metadata, 'Only lyrics here')).originalKey).toBe(expected)
  })

  it.each([
    ['Am Dm E7 Am', 'C'], ['C#m F#m G#7 C#m', 'E'], ['Dm Gm A7 Dm', 'F'],
    ['F#m Bm C#7 F#m', 'A'], ['Bbm Ebm F7 Bbm', 'Db'], ['G#m C#m D#7 G#m', 'B'],
  ])('normalizes detected minor chart %s before falling back to metadata', async (chords, expected) => {
    expect((await fetchSong('D', `[Verse]\n${chords}`)).originalKey).toBe(expected)
  })

  it('keeps detected major ahead of minor metadata', async () => {
    expect((await fetchSong('Am', '[Verse]\nD G A7 D')).originalKey).toBe('D')
  })

  it.each([null, '', 'H#m', 'not a key'])('keeps missing or invalid fallback %s null', async metadata => {
    expect((await fetchSong(metadata, 'Only lyrics here')).originalKey).toBeNull()
  })
})
