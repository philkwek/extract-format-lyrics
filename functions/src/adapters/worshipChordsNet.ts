import * as cheerio from 'cheerio'
import { normalizeChartSectionLabels } from './chartSectionLabels.js'
import type { RawSong, SiteAdapter } from './types.js'

export const worshipChordsNetAdapter: SiteAdapter = {
  site: 'worshipchords-net',

  matches(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'worshipchords.net' || u.hostname.endsWith('.worshipchords.net')
    } catch {
      return false
    }
  },

  extract(html: string): RawSong {
    const $ = cheerio.load(html)

    if (
      $('#challenge-error-text, .cf-browser-verification').length > 0 ||
      /Just a moment|Attention Required/i.test($('title').text())
    ) {
      const err = new Error('worshipchords.net: Access blocked by anti-bot verification')
      Object.assign(err, { code: 'BLOCKED' })
      throw err
    }

    const title = $('span.stitle').first().text().trim()
    const artist = $('#atname').first().text().trim()
    const originalKey =
      $('#song-id').attr('data-key')?.trim() ||
      $('#original-key').first().text().trim() ||
      $('.song-key').first().attr('data-c')?.trim() ||
      $('.song-key').first().text().trim() ||
      null

    const capo = Number.parseInt($('#song-id').attr('data-capo') ?? '', 10)
    const content = normalizeChartSectionLabels($('pre#song-cont').first().text(), {
      dropTrailingBibleVerse: true,
    })

    if (!content) {
      throw new Error('worshipchords.net: Could not locate chord chart content')
    }

    return {
      title: title || 'Unknown Title',
      artist: artist || 'Unknown Artist',
      originalKey,
      ...(Number.isFinite(capo) && capo > 0 ? { capo } : {}),
      content,
    }
  },
}
