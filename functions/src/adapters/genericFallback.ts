import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'
import { isChordLine } from '../chords.js'

export const genericFallbackAdapter: SiteAdapter = {
  site: 'generic',

  matches(): boolean {
    return true // Fallback matches any URL
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    // Try finding title from h1 or page title
    const titleEl = $('h1').first().text().trim() || $('title').text().trim()
    let title = titleEl || 'Unknown Title'
    let artist = 'Unknown Artist'

    const splitMatch = title.match(/^(.+?)\s+[–—-]\s+(.+)$/)
    if (splitMatch) {
      title = splitMatch[1].trim()
      artist = splitMatch[2].trim()
    }

    // Look for preformatted chord text in <pre> tags
    let content = ''
    $('pre').each((_, el) => {
      const text = $(el).text()
      // Check if lines in this <pre> contain chord lines
      const lines = text.split('\n')
      const chordLines = lines.filter(isChordLine)
      if (chordLines.length >= 2 && text.length > content.length) {
        content = text
      }
    })

    // If no <pre> tag matched, look for code or block with chords
    if (!content) {
      $('div, article, section').each((_, el) => {
        const text = $(el).text()
        const lines = text.split('\n')
        const chordLines = lines.filter(isChordLine)
        if (chordLines.length >= 3 && text.length < 20000 && text.length > content.length) {
          content = text
        }
      })
    }

    if (!content.trim()) {
      throw new Error('Generic fallback: No chord content found on page')
    }

    return {
      title,
      artist,
      originalKey: null,
      content: content.trim(),
    }
  },
}
