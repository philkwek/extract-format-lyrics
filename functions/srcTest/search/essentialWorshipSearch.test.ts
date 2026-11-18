import { describe, expect, it, vi } from 'vitest'
import {
  essentialWorshipSearchAdapter,
  parseEssentialWorshipSearchHtml,
} from '../../src/search/essentialWorshipSearch.js'
import { SearchParseError } from '../../src/search/types.js'
import * as safeFetch from '../../src/safeFetch.js'

describe('parseEssentialWorshipSearchHtml', () => {
  it('parses song-info cards with title, artist and URL', () => {
    const html = `
      <html>
        <head><title>Find A Song | Essential Worship</title></head>
        <body>
          <div class="song-info">
            <h2>
              <a href="https://essentialworship.com/songs/demo-artist/morning-light/">
                Morning Light
              </a>
            </h2>
            <h3>recorded by: Demo Artist</h3>
          </div>
          <div class="song-info">
            <h2>
              <a href="/songs/another-artist/evening-song/">Evening Song</a>
            </h2>
            <h3>recorded by: Another Artist</h3>
          </div>
        </body>
      </html>
    `
    expect(parseEssentialWorshipSearchHtml(html)).toEqual([
      {
        site: 'essentialworship',
        title: 'Morning Light',
        artist: 'Demo Artist',
        url: 'https://essentialworship.com/songs/demo-artist/morning-light/',
        type: 'Chords',
      },
      {
        site: 'essentialworship',
        title: 'Evening Song',
        artist: 'Another Artist',
        url: 'https://essentialworship.com/songs/another-artist/evening-song/',
        type: 'Chords',
      },
    ])
  })

  it('returns empty array on valid Find A Song page with no matches', () => {
    const html = `
      <html>
        <head><title>Find A Song | Essential Worship</title></head>
        <body><h1>Find A Song</h1></body>
      </html>
    `
    expect(parseEssentialWorshipSearchHtml(html)).toEqual([])
  })

  it('throws 403 error on Cloudflare challenge page', () => {
    const html = `<html><head><title>Just a moment...</title></head><body></body></html>`
    expect(() => parseEssentialWorshipSearchHtml(html)).toThrow('anti-bot verification')
  })

  it('throws SearchParseError when page shape changed', () => {
    const html = `<html><head><title>Unexpected</title></head><body></body></html>`
    expect(() => parseEssentialWorshipSearchHtml(html)).toThrow(SearchParseError)
  })
})

describe('essentialWorshipSearchAdapter', () => {
  it('fetches the find-a-song search URL and parses results', async () => {
    const fetchSpy = vi.spyOn(safeFetch, 'safeFetchHtml').mockResolvedValueOnce({
      text: `<html><head><title>Find A Song | Essential Worship</title></head><body></body></html>`,
      finalUrl: 'https://essentialworship.com/find-a-song/?search=morning',
      contentType: 'text/html',
    })

    const results = await essentialWorshipSearchAdapter.search('morning')
    expect(results).toEqual([])
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://essentialworship.com/find-a-song/?search=morning',
      { timeoutMs: 3000 },
    )
    fetchSpy.mockRestore()
  })
})
