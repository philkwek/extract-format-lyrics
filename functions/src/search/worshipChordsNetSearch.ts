import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { SearchParseError } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

const BASE_URL = 'https://www.worshipchords.net'
const RESULT_LIMIT = 10

function isChallengePage($: cheerio.CheerioAPI): boolean {
  return (
    $('#challenge-error-text, .cf-browser-verification').length > 0 ||
    /Just a moment|Attention Required/i.test($('title').text())
  )
}

export function parseWorshipChordsNetSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)

  if (isChallengePage($)) {
    throw new SearchParseError('worshipchords.net: Access blocked by anti-bot verification')
  }

  const itemCount = $('a.song-item').length
  if (itemCount > 0 && !$('.songlist').length) {
    throw new SearchParseError('worshipchords.net: search result list shape changed')
  }

  const results: SearchCandidate[] = []
  const seen = new Set<string>()
  $('a.song-item').each((_, element) => {
    if (results.length >= RESULT_LIMIT) return
    const href = $(element).attr('href')
    const title = $(element).find('.tit').first().text().trim()
    const artist = $(element).find('.art').first().text().trim()
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
      site: 'worshipchords-net',
      title,
      artist: artist || 'Unknown Artist',
      url,
      type: 'Chords',
    })
  })

  if (itemCount > 0 && results.length === 0) {
    throw new SearchParseError('worshipchords.net: search result items could not be parsed')
  }

  // A zero-result page still renders the "Search result for …" heading.
  if (results.length === 0 && !/Search result for/i.test($('body').text())) {
    throw new SearchParseError('worshipchords.net: search result page shape changed')
  }

  return results
}

export const worshipChordsNetSearchAdapter: SearchAdapter = {
  site: 'worshipchords-net',

  async search(query: string): Promise<SearchCandidate[]> {
    const url = `${BASE_URL}/search?val=${encodeURIComponent(query)}`
    const { text: html } = await safeFetchHtml(url)
    return parseWorshipChordsNetSearchHtml(html)
  },
}
