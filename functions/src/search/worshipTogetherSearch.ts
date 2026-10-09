import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

export function parseWorshipTogetherSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)
  const results: SearchCandidate[] = []

  $('a[href^="/songs/"]').each((_, el) => {
    const href = $(el).attr('href')
    const title = $(el).text().trim()
    if (href && href !== '/songs/' && !href.includes('?') && title && title.length > 2) {
      const fullUrl = `https://www.worshiptogether.com${href}`
      if (!results.some((r) => r.url === fullUrl)) {
        results.push({
          site: 'worshiptogether',
          title,
          artist: 'Worship Together Artist',
          url: fullUrl,
          type: 'Chords',
        })
      }
    }
  })

  return results.slice(0, 10)
}

export const worshipTogetherSearchAdapter: SearchAdapter = {
  site: 'worshiptogether',

  async search(query: string): Promise<SearchCandidate[]> {
    const url = `https://www.worshiptogether.com/songs/?nav=1&q=${encodeURIComponent(query)}`
    try {
      const { text: html } = await safeFetchHtml(url)
      return parseWorshipTogetherSearchHtml(html)
    } catch {
      return []
    }
  },
}
