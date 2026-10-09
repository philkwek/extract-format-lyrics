import { describe, it, expect } from 'vitest'
import { genericFallbackAdapter } from './genericFallback.js'
import { normalizeSongText } from '../normalizer.js'

describe('genericFallbackAdapter', () => {
  it('extracts chords and lyrics from pre tag', () => {
    const html = `
      <html>
        <head><title>House of the Rising Sun - The Animals</title></head>
        <body>
          <h1>House of the Rising Sun – The Animals</h1>
          <pre>
[Verse 1]
Am     C        D          F
There is a house in New Orleans
Am         C        E7
They call the Rising Sun
          </pre>
        </body>
      </html>
    `

    const raw = genericFallbackAdapter.extract(html, 'https://unknown-chord-site.com/song')
    expect(raw.title).toBe('House of the Rising Sun')
    expect(raw.artist).toBe('The Animals')
    expect(raw.content).toContain('There is a house')

    const sections = normalizeSongText(raw.content)
    expect(sections.length).toBe(1)
    expect(sections[0].type).toBe('Verse')
  })

  it('throws error when no chord sheet is present', () => {
    const html = `<html><body><h1>Hello World</h1><p>No chords here</p></body></html>`
    expect(() => genericFallbackAdapter.extract(html, 'https://test.com')).toThrow(/No chord content found/)
  })
})
