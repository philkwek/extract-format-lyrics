import * as cheerio from 'cheerio'
import { normalizeChartSectionLabels } from './chartSectionLabels.js'
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
    if (
      $('#challenge-error-text, .cf-browser-verification').length > 0 ||
      /Just a moment|Attention Required/i.test($('title').text())
    ) {
      const err = new Error('worshipchords: Access blocked by anti-bot verification')
      Object.assign(err, { code: 'BLOCKED' })
      throw err
    }

    const titleEl = $('h1.entry-title, h1.song-title, .archive_header h1, h1')
      .first()
      .text()
      .trim()
    let title: string
    let artist = 'Unknown Artist'

    const splitMatch = titleEl.match(/^(.+?)\s+[–—-]\s+(.+)$/)
    if (splitMatch) {
      title = splitMatch[1].trim()
      artist = splitMatch[2].trim()
    } else {
      // The live site titles chart pages "<Song> Chords" and lists performers
      // in the post-meta line rather than in the heading.
      title = titleEl.replace(/\s+Chords$/i, '').trim()
      const artistText = $('.post-artists-authors .categories').first().text().trim()
      if (artistText) artist = artistText
    }

    // Try finding chords in pre tag or chordpro container
    let content = ''
    let originalKey: string | null = null

    const preEl = $('pre').first()
    if (preEl.length > 0) {
      content = normalizeChartSectionLabels(preEl.text(), {
        dropTrailingBibleVerse: true,
      })
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
