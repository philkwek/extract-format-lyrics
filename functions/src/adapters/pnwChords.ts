import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'

export const pnwChordsAdapter: SiteAdapter = {
  site: 'pnwchords',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'pnwchords.com' || u.hostname.endsWith('.pnwchords.com')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    // Title & Artist: typically in h1 e.g. "Good Grace – Hillsong Worship"
    const heading = $('h1.entry-title, h1.page-title, h1').first().text().trim()
    let title = heading
    let artist = 'Unknown Artist'

    // Split on en-dash, em-dash, or hyphen
    const splitMatch = heading.match(/^(.+?)\s+[–—-]\s+(.+)$/)
    if (splitMatch) {
      title = splitMatch[1].trim()
      artist = splitMatch[2].trim()
    }

    const preEl = $('pre').first()
    if (preEl.length === 0) {
      throw new Error('pnwchords: Could not find chord content (<pre> tag)')
    }

    const originalKey = preEl.attr('data-key') || null
    const content = preEl.text().trim()

    if (!content) {
      throw new Error('pnwchords: Chord content is empty')
    }

    return {
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      originalKey,
      content,
    }
  },
}
