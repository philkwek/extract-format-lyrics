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
  })
})
