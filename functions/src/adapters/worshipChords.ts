import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'

export const worshipChordsAdapter: SiteAdapter = {
  site: 'worshipchords',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'worshipchords.com' || u.hostname.endsWith('.worshipchords.com')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    // Check for Cloudflare / bot gating
    if ($('#challenge-error-text, .cf-browser-verification').length > 0 || $('title').text().includes('Just a moment')) {
      const err = new Error('worshipchords: Access blocked by anti-bot verification')
      Object.assign(err, { code: 'BLOCKED' })
      throw err
    }

    const titleEl = $('h1.entry-title, h1.song-title, h1').first().text().trim()
    let title = titleEl
    let artist = 'Unknown Artist'

    const splitMatch = titleEl.match(/^(.+?)\s+[–—-]\s+(.+)$/)
    if (splitMatch) {
      title = splitMatch[1].trim()
      artist = splitMatch[2].trim()
    }

    // Try finding chords in pre tag or chordpro container
    let content = ''
    let originalKey: string | null = null

    const preEl = $('pre').first()
    if (preEl.length > 0) {
      content = preEl.text().trim()
      originalKey = preEl.attr('data-key') || null
    }

    if (!originalKey) {
      const metaText = $('.song-meta, .meta-info, body').text()
      const keyMatch = metaText.match(/Key:\s*([A-G][#b]?m?)/i)
      if (keyMatch) {
        originalKey = keyMatch[1]
      }
    }

    if (!content) {
      throw new Error('worshipchords: Could not locate chord chart content')
    }

    return {
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      originalKey,
      content,
    }
  },
}
