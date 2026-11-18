import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'

export const essentialWorshipAdapter: SiteAdapter = {
  site: 'essentialworship',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'essentialworship.com' || u.hostname.endsWith('.essentialworship.com')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    const title = $('h1.song-title, h1').first().text().trim() || 'Unknown Title'
    const rawArtist = $('h1.song-title + h2, h1 + h2').first().text().trim()
    const artist = rawArtist.replace(/^By:\s*/i, '').trim() || 'Unknown Artist'

    const preEl = $('pre#chords, pre').first()
    if (preEl.length === 0) {
      throw new Error('essentialworship: Could not find chord content (<pre> tag)')
    }

    const originalKey = preEl.attr('data-key') || null
    const content = preEl.text().trim()

    if (!content) {
      throw new Error('essentialworship: Chord content is empty')
    }

    return {
      title,
      artist,
      originalKey,
      content,
    }
  },
}
