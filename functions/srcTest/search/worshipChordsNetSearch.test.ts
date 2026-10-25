import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseWorshipChordsNetSearchHtml } from '../../src/search/worshipChordsNetSearch.js'
import { SearchParseError } from '../../src/search/types.js'

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf-8')
}

describe('parseWorshipChordsNetSearchHtml', () => {
  it('parses song items with title, artist and absolute URL', () => {
    const results = parseWorshipChordsNetSearchHtml(fixture('worshipchordsnet-search.html'))
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      site: 'worshipchords-net',
      title: 'Goodness Of God',
      artist: 'Bethel Music',
      url: 'https://www.worshipchords.net/guitar/bethel-music/goodness-of-god-169394',
      type: 'Chords',
    })
    expect(results[1].title).toBe('Goodness of God (Tagalog)')
  })

  it('returns an empty list for a valid zero-result page', () => {
    expect(parseWorshipChordsNetSearchHtml(fixture('worshipchordsnet-search-empty.html'))).toEqual([])
  })

  it('throws for a challenge page instead of treating it as no matches', () => {
    const html = `<html><head><title>Attention Required! | Cloudflare</title></head><body></body></html>`
    expect(() => parseWorshipChordsNetSearchHtml(html)).toThrow(SearchParseError)
  })

  it('throws when the page shape changes', () => {
    expect(() => parseWorshipChordsNetSearchHtml('<html><body>Not a search page</body></html>')).toThrow(
      SearchParseError
    )
  })

  it('deduplicates URLs and caps at ten results', () => {
    const items = Array.from({ length: 12 }, (_, index) => {
      const id = index === 1 ? 0 : index
      return `
        <div class="songlist">
          <a class="song-item" href="/guitar/artist/song-${id}">
            <div class="tit">Song ${index}</div>
            <div class="art">Artist</div>
          </a>
        </div>
      `
    }).join('')
    const results = parseWorshipChordsNetSearchHtml(`<html><body>${items}</body></html>`)
    expect(results).toHaveLength(10)
    expect(results[0].url).toBe('https://www.worshipchords.net/guitar/artist/song-0')
    expect(new Set(results.map((result) => result.url)).size).toBe(results.length)
  })
})
