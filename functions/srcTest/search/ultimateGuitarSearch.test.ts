import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseUgSearchHtml } from '../../src/search/ultimateGuitarSearch.js'
import { SearchParseError } from '../../src/search/types.js'

describe('parseUgSearchHtml', () => {
  it('extracts search candidate versions from fixture', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'ug-search.html')
    const html = fs.readFileSync(fixturePath, 'utf-8')

    const candidates = parseUgSearchHtml(html)
    expect(candidates.length).toBe(2)
    expect(candidates[0].title).toBe('Hallelujah')
    expect(candidates[0].artist).toBe('Leonard Cohen')
    expect(candidates[0].versionLabel).toBe('Ver 1')
    expect(candidates[0].url).toContain('leonard-cohen')
    expect(candidates[1].artist).toBe('Jeff Buckley')
  })

  it('returns an empty list for a valid page with no results', () => {
    const html = `<div class="js-store" data-content="${JSON.stringify({
      store: { page: { data: { results: [] } } },
    }).replace(/"/g, '&quot;')}"></div>`
    expect(parseUgSearchHtml(html)).toEqual([])
  })

  it('reports a recognisable schema/parser failure instead of an empty search', () => {
    expect(() => parseUgSearchHtml('<html><body>no store</body></html>')).toThrow(SearchParseError)
    expect(() =>
      parseUgSearchHtml('<div class="js-store" data-content="{not-json}"></div>')
    ).toThrow(SearchParseError)
  })
})
