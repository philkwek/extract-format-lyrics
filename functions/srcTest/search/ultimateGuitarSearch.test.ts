import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  isAccessibleUgChordResult,
  parseUgSearchHtml,
} from '../../src/search/ultimateGuitarSearch.js'
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
    expect(candidates.every((candidate) => !candidate.url.includes('/pro/'))).toBe(true)
    expect(candidates.every((candidate) => candidate.type === 'Chords')).toBe(true)
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

describe('isAccessibleUgChordResult', () => {
  const publicChord = {
    tab_url: 'https://tabs.ultimate-guitar.com/tab/artist/song-chords-1',
    type: 'Chords',
  }

  it('keeps public chord listings, including the legacy type_name field', () => {
    expect(isAccessibleUgChordResult(publicChord)).toBe(true)
    expect(
      isAccessibleUgChordResult({
        tab_url: publicChord.tab_url,
        type_name: 'Chords',
      })
    ).toBe(true)
  })

  it.each([
    ['marketing_type official', { ...publicChord, marketing_type: 'official' }],
    ['marketing_type TabPro', { ...publicChord, marketing_type: 'TabPro' }],
    ['type Official', { ...publicChord, type: 'Official' }],
    ['typeLabel Pro', { ...publicChord, typeLabel: 'Pro' }],
    ['pro access type', { ...publicChord, tab_access_type: 'pro' }],
    [
      'pro URL',
      {
        tab_url: 'https://www.ultimate-guitar.com/pro/?tab_id=1',
        type: 'Chords',
      },
    ],
    ['tabs listing', { ...publicChord, type: 'Tabs' }],
  ])('rejects %s', (_label, result) => {
    expect(isAccessibleUgChordResult(result)).toBe(false)
  })
})
