import * as cheerio from 'cheerio'
import type { RawSong, SiteAdapter } from './types.js'

export const worshipTogetherAdapter: SiteAdapter = {
  site: 'worshiptogether',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'worshiptogether.com' || u.hostname.endsWith('.worshiptogether.com')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    const titleEl = $('h1.t-song-details__marquee__headline, h1').first().text().trim()
    const title = titleEl || 'Unknown Title'

    // Artist from marquee author line
    const artistEl = $('.t-song-details__marquee p.large a, p.large a').first().text().trim()
    const artist = artistEl || 'Unknown Artist'

    // Original key from #keySelector
    const originalKey = $('#keySelector option').first().attr('value') || null

    // Extract lines from .chord-pro-disp
    const chordDisp = $('.chord-pro-disp')
    if (chordDisp.length === 0) {
      throw new Error('worshiptogether: Could not find chord chart container (.chord-pro-disp)')
    }

    const outputLines: string[] = []

    chordDisp.find('.chord-pro-line').each((_, lineEl) => {
      const segments = $(lineEl).find('.chord-pro-segment')
      let chordLine = ''
      let lyricLine = ''
      let hasChords = false
      let hasLyrics = false

      segments.each((_, segEl) => {
        let note = $(segEl).find('.chord-pro-note').text().replace(/\u00a0/g, ' ').trim()
        let lyric = $(segEl).find('.chord-pro-lyric').text().replace(/\u00a0/g, ' ')

        if (note) hasChords = true
        if (lyric.trim()) hasLyrics = true

        // Pad segments so chords align above their corresponding lyrics
        const maxLen = Math.max(note.length, lyric.length)
        if (note) {
          note = note.padEnd(maxLen, ' ')
        } else {
          note = ' '.repeat(maxLen)
        }
        lyric = lyric.padEnd(maxLen, ' ')

        chordLine += note
        lyricLine += lyric
      })

      // If line only had headers like "Verse 1" (which are placed in chord-pro-lyric with empty note)
      if (!hasChords && hasLyrics && /^(verse|chorus|bridge|intro|outro|pre-chorus|instrumental)/i.test(lyricLine.trim())) {
        outputLines.push(`[${lyricLine.trim()}]`)
      } else if (hasChords && !hasLyrics) {
        outputLines.push(chordLine.trimEnd())
      } else if (hasChords && hasLyrics) {
        outputLines.push(chordLine.trimEnd())
        outputLines.push(lyricLine.trimEnd())
      } else if (lyricLine.trim()) {
        outputLines.push(lyricLine.trimEnd())
      }
    })

    const content = outputLines.join('\n').trim()
    if (!content) {
      throw new Error('worshiptogether: Failed to extract lyrics and chords')
    }

    return {
      title,
      artist,
      originalKey,
      content,
    }
  },
}
