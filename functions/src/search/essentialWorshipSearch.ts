import * as cheerio from 'cheerio'
import type { SearchAdapter, SearchCandidate } from './types.js'
import { SEARCH_TIMEOUT_MS, SearchParseError } from './types.js'
import { safeFetchHtml } from '../safeFetch.js'

const BASE_URL = 'https://essentialworship.com'
const RESULT_LIMIT = 10

function isChallengePage($: cheerio.CheerioAPI): boolean {
  return (
    $('#challenge-error-text, .cf-browser-verification').length > 0 ||
    /Just a moment|Attention Required/i.test($('title').text())
  )
}

export function parseEssentialWorshipSearchHtml(html: string): SearchCandidate[] {
  const $ = cheerio.load(html)

  if (isChallengePage($)) {
    const err = new Error('essentialworship.com: Access blocked by anti-bot verification')
    Object.assign(err, { status: 403 })
    throw err
  }

  const itemCount = $('.song-info').length
  const results: SearchCandidate[] = []
  const seen = new Set<string>()

  $('.song-info').each((_, element) => {
    if (results.length >= RESULT_LIMIT) return
    const link = $(element).find('h2 a[href]').first()
    const href = link.attr('href')
    const title = link.text().trim()
    const rawArtist = $(element).find('h3').first().text().trim()
    const artist = rawArtist.replace(/^recorded by:\s*/i, '').trim()
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
      site: 'essentialworship',
      title,
      artist: artist || 'Unknown Artist',
      url,
      type: 'Chords',
    })
  })

  if (itemCount > 0 && results.length === 0) {
    throw new SearchParseError('essentialworship.com: search result items could not be parsed')
  }

  if (results.length === 0 && !/Find A Song/i.test($('h1, title').text())) {
    throw new SearchParseError('essentialworship.com: search result page shape changed')
  }

  return results
}

export const essentialWorshipSearchAdapter: SearchAdapter = {
  site: 'essentialworship',

  async search(query: string): Promise<SearchCandidate[]> {
    const url = `${BASE_URL}/find-a-song/?search=${encodeURIComponent(query)}`
    const { text: html } = await safeFetchHtml(url, { timeoutMs: SEARCH_TIMEOUT_MS })
    return parseEssentialWorshipSearchHtml(html)
  },
}
