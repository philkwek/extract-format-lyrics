import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { SearchParseError } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

interface UgSearchResultItem {
  id?: number
  song_name?: string
  artist_name?: string
  tab_url?: string
  /** Legacy search payload field. */
  type_name?: string
  /** Current search payload field, e.g. "Chords" or "Tabs". */
  type?: string
  typeLabel?: string
  /** "official" and "TabPro" entries link to inaccessible paid content. */
  marketing_type?: string
  tab_access_type?: string
  version?: number
  rating?: number
}

const INACCESSIBLE_TYPES = new Set(['official', 'pro', 'tabpro'])

/**
 * Official and Pro search rows are marketing links, not public chord sheets.
 * They often omit `type` entirely, so every marker must be checked.
 */
export function isAccessibleUgChordResult(result: UgSearchResultItem): boolean {
  if (!result.tab_url) return false

  const markers = [result.type, result.type_name, result.typeLabel, result.marketing_type]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
  if (markers.some((value) => INACCESSIBLE_TYPES.has(value))) {
    return false
  }

  if (
    typeof result.tab_access_type === 'string' &&
    INACCESSIBLE_TYPES.has(result.tab_access_type.trim().toLowerCase())
  ) {
    return false
  }

  try {
    const url = new URL(result.tab_url)
    if (url.pathname === '/pro' || url.pathname.startsWith('/pro/')) return false
  } catch {
    return false
  }

  const type = (result.type ?? result.type_name ?? '').trim().toLowerCase()
  return type === '' || type === 'chords'
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
  if (!rawData) {
    throw new SearchParseError('Ultimate Guitar search data container is missing')
  }

  let parsed: UgSearchStore
  try {
    parsed = JSON.parse(rawData) as UgSearchStore
  } catch (err) {
    throw new SearchParseError(`Ultimate Guitar search data is invalid: ${(err as Error).message}`)
  }
  const results = parsed?.store?.page?.data?.results
  if (!Array.isArray(results)) {
    throw new SearchParseError('Ultimate Guitar search result shape changed')
  }

  return results
    .filter(isAccessibleUgChordResult)
    .slice(0, 10)
    .map((r) => ({
      site: 'ultimate-guitar',
      title: r.song_name || 'Unknown',
      artist: r.artist_name || 'Unknown',
      url: r.tab_url!,
      versionLabel: r.version ? `Ver ${r.version}` : undefined,
      rating: r.rating,
      type: r.type ?? r.type_name ?? 'Chords',
    }))
}

export const ultimateGuitarSearchAdapter: SearchAdapter = {
  site: 'ultimate-guitar',

  async search(query: string): Promise<SearchCandidate[]> {
    const encoded = encodeURIComponent(query)
    const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encoded}`
    const { text: html } = await safeFetchHtml(url)
    return parseUgSearchHtml(html)
  },
}
