import { describe, expect, it } from 'vitest'
import { essentialWorshipAdapter } from '../../src/adapters/essentialWorship.js'

describe('essentialWorshipAdapter', () => {
  it('matches essentialworship.com URLs', () => {
    expect(
      essentialWorshipAdapter.matches('https://essentialworship.com/songs/demo-artist/demo-song/')
    ).toBe(true)
    expect(essentialWorshipAdapter.matches('https://pnwchords.com/song')).toBe(false)
  })

  it('extracts title, artist, key and preformatted chords', () => {
    const html = `
      <html>
        <body>
          <h1 class="song-title">Morning Light</h1>
          <h2>By: Demo Worship</h2>
          <pre id="chords" data-key="G">
[Verse 1]
G              D
Morning light breaks through the night
          </pre>
        </body>
      </html>
    `
    const raw = essentialWorshipAdapter.extract(html, 'https://essentialworship.com/songs/demo-worship/morning-light/')
    expect(raw.title).toBe('Morning Light')
    expect(raw.artist).toBe('Demo Worship')
    expect(raw.originalKey).toBe('G')
    expect(raw.content).toContain('[Verse 1]')
    expect(raw.content).toContain('Morning light breaks through the night')
  })

  it('throws when <pre> tag is missing', () => {
    expect(() =>
      essentialWorshipAdapter.extract('<html><body><h1>No Chords</h1></body></html>', 'https://essentialworship.com/songs/x/')
    ).toThrow('Could not find chord content')
  })
})
