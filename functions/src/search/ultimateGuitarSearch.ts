import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

interface UgSearchResultItem {
  id?: number
  song_name?: string
  artist_name?: string
  tab_url?: string
  type_name?: string
  version?: number
  rating?: number
}

interface UgSearchStore {
  store?: {
    page?: {
      data?: {
        results?: UgSearchResultItem[]
      }
    }
  }
}

export function parseUgSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)
  const storeEl = $('div.js-store')
  const rawData = storeEl.attr('data-content')
  if (!rawData) return []

  try {
    const parsed = JSON.parse(rawData) as UgSearchStore
    const results = parsed?.store?.page?.data?.results || []

    return results
      .filter((r) => r.tab_url && (r.type_name === 'Chords' || !r.type_name))
      .slice(0, 10)
      .map((r) => ({
        site: 'ultimate-guitar',
        title: r.song_name || 'Unknown',
        artist: r.artist_name || 'Unknown',
        url: r.tab_url!,
        versionLabel: r.version ? `Ver ${r.version}` : undefined,
        rating: r.rating,
        type: r.type_name || 'Chords',
      }))
  } catch {
    return []
  }
}

export const ultimateGuitarSearchAdapter: SearchAdapter = {
  site: 'ultimate-guitar',

  async search(query: string): Promise<SearchCandidate[]> {
    const encoded = encodeURIComponent(query)
    const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encoded}`
    try {
      const { text: html } = await safeFetchHtml(url)
      return parseUgSearchHtml(html)
    } catch {
      return []
    }
  },
}
