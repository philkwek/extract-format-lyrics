import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

export function parsePnwSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)
  const results: SearchCandidate[] = []

  $('h2.entry-title, h2.post-title').each((_, el) => {
    const linkEl = $(el).find('a')
    const href = linkEl.attr('href')
    const text = linkEl.text().trim() || $(el).text().trim()

    if (href && text) {
      let title = text
      let artist = 'Unknown'
      const split = text.match(/^(.+?)\s+[–—-]\s+(.+)$/)
      if (split) {
        title = split[1].trim()
        artist = split[2].trim()
      }

      results.push({
        site: 'pnwchords',
        title,
        artist,
        url: href,
        type: 'Chords',
      })
    }
  })

  return results.slice(0, 10)
}

export const pnwChordsSearchAdapter: SearchAdapter = {
  site: 'pnwchords',

  async search(query: string): Promise<SearchCandidate[]> {
    const url = `https://pnwchords.com/?s=${encodeURIComponent(query)}`
    try {
      const { text: html } = await safeFetchHtml(url)
      return parsePnwSearchHtml(html)
    } catch {
      return []
    }
  },
}
