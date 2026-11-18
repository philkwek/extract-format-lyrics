import { describe, expect, it, vi } from 'vitest'
import {
  parseWorshipChordsSearchHtml,
  WORSHIP_CHORDS_SEARCH_TIMEOUT_MS,
  worshipChordsSearchAdapter,
} from '../../src/search/worshipChordsSearch.js'
import { SearchParseError } from '../../src/search/types.js'
import { classifySearchError } from '../../src/search/searchSites.js'
import * as safeFetch from '../../src/safeFetch.js'

describe('parseWorshipChordsSearchHtml', () => {
  it('parses song items with title, artist and absolute URL', () => {
    const html = `
      <html>
        <head><title>You searched for "grace" - Worship Chords</title></head>
        <body>
          <div class="col-left main">
            <h1 class="archive_header">Search results for: "grace"</h1>
            <ul>
              <div class="artist-songs">
                <li>
                  <a href="https://worshipchords.com/amazing-grace-chords/" rel="bookmark" title="Amazing Grace">Amazing Grace</a>
                  by <span class="categories">Chris Tomlin, John Newton</span>
                </li>
              </div>
              <div class="artist-songs">
                <li>
                  <a href="/grace-to-grace-chords/" rel="bookmark" title="Grace To Grace">Grace To Grace</a>
                  by <span class="categories">Hillsong Worship</span>
                </li>
              </div>
            </ul>
          </div>
        </body>
      </html>
    `
    const results = parseWorshipChordsSearchHtml(html)
    expect(results).toEqual([
      {
        site: 'worshipchords',
        title: 'Amazing Grace',
        artist: 'Chris Tomlin, John Newton',
        url: 'https://worshipchords.com/amazing-grace-chords/',
        type: 'Chords',
      },
      {
        site: 'worshipchords',
        title: 'Grace To Grace',
        artist: 'Hillsong Worship',
        url: 'https://worshipchords.com/grace-to-grace-chords/',
        type: 'Chords',
      },
    ])
  })

  it('returns an empty list for a valid zero-result page', () => {
    const html = `
      <html>
        <head><title>You searched for "nothing" - Worship Chords</title></head>
        <body>
          <div class="col-left">
            <p>Sorry, no songs matched your search...</p>
          </div>
        </body>
      </html>
    `
    expect(parseWorshipChordsSearchHtml(html)).toEqual([])
  })

  it('throws a 403 error for a Cloudflare challenge page so the circuit breaker classifies it as blocked', () => {
    const html = `<html><head><title>Just a moment...</title></head><body><span id="challenge-error-text">Enable JavaScript</span></body></html>`
    let caught: unknown
    try {
      parseWorshipChordsSearchHtml(html)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(classifySearchError(caught).failure).toBe('blocked')
  })

  it('throws SearchParseError when the page shape changes', () => {
    expect(() => parseWorshipChordsSearchHtml('<html><body>Not a search page</body></html>')).toThrow(
      SearchParseError
    )
  })

  it('deduplicates URLs and caps at ten results', () => {
    const items = Array.from({ length: 12 }, (_, index) => {
      const id = index === 1 ? 0 : index
      return `
        <div class="artist-songs">
          <li>
            <a href="https://worshipchords.com/song-${id}-chords/" rel="bookmark">Song ${index}</a>
            by <span class="categories">Artist</span>
          </li>
        </div>
      `
    }).join('')
    const results = parseWorshipChordsSearchHtml(`<html><body><ul>${items}</ul></body></html>`)
    expect(results).toHaveLength(10)
    expect(results[0].url).toBe('https://worshipchords.com/song-0-chords/')
    expect(new Set(results.map((result) => result.url)).size).toBe(results.length)
  })
})

describe('worshipChordsSearchAdapter', () => {
  it('fetches search HTML with the dedicated 8s timeout', async () => {
    const spy = vi.spyOn(safeFetch, 'safeFetchHtml').mockResolvedValueOnce({
      text: '<html><body><h1>Search results for: "grace"</h1></body></html>',
      finalUrl: 'https://worshipchords.com/?s=grace',
      contentType: 'text/html',
    })
    try {
      const results = await worshipChordsSearchAdapter.search('grace')
      expect(results).toEqual([])
      expect(spy).toHaveBeenCalledWith('https://worshipchords.com/?s=grace', {
        timeoutMs: WORSHIP_CHORDS_SEARCH_TIMEOUT_MS,
      })
      expect(WORSHIP_CHORDS_SEARCH_TIMEOUT_MS).toBe(8_000)
    } finally {
      spy.mockRestore()
    }
  })
})
