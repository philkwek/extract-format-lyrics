import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { SearchParseError } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

const BASE_URL = 'https://worshipchords.com'
const RESULT_LIMIT = 10
/** WordPress search on worshipchords.com averages ~4 s; keep 3 s for faster sources. */
export const WORSHIP_CHORDS_SEARCH_TIMEOUT_MS = 8_000

function isChallengePage($: cheerio.CheerioAPI): boolean {
  return (
    $('#challenge-error-text, .cf-browser-verification').length > 0 ||
    /Just a moment|Attention Required/i.test($('title').text())
  )
}

export function parseWorshipChordsSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)

  if (isChallengePage($)) {
    const err = new Error('worshipchords.com: Access blocked by anti-bot verification')
    Object.assign(err, { status: 403 })
    throw err
  }

  const itemCount = $('.artist-songs').length
  const results: SearchCandidate[] = []
  const seen = new Set<string>()

  $('.artist-songs').each((_, element) => {
    if (results.length >= RESULT_LIMIT) return
    const link = $(element).find('a[rel="bookmark"]').first()
    const href = link.attr('href')
    const title = link.text().trim() || link.attr('title')?.trim() || ''
    const artist = $(element).find('.categories').first().text().trim()
    if (!href || !title) return

    let url: string
    try {
      url = new URL(href, BASE_URL).toString()
    } catch {
      return
    }
    if (seen.has(url)) return
    seen.add(url)
    results.push({
      site: 'worshipchords',
      title,
      artist: artist || 'Unknown Artist',
      url,
      type: 'Chords',
    })
  })

  if (itemCount > 0 && results.length === 0) {
    throw new SearchParseError('worshipchords.com: search result items could not be parsed')
  }

  if (
    results.length === 0 &&
    !/Search results for:/i.test($('h1').text()) &&
    !/no songs matched your search/i.test($('body').text())
  ) {
    throw new SearchParseError('worshipchords.com: search result page shape changed')
  }

  return results
}

export const worshipChordsSearchAdapter: SearchAdapter = {
  site: 'worshipchords',

  async search(query: string): Promise<SearchCandidate[]> {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`
    const { text: html } = await safeFetchHtml(url, { timeoutMs: WORSHIP_CHORDS_SEARCH_TIMEOUT_MS })
    return parseWorshipChordsSearchHtml(html)
  },
}
