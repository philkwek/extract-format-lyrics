import { describe, expect, it } from 'vitest'
import { canonicalCandidateUrl, selectSearchResults } from '../../src/search/selectResults.js'
import type { SearchCandidate } from '../../src/search/types.js'

function result(
  site: string,
  title: string,
  url: string,
  rating?: number,
  versionLabel?: string
): SearchCandidate {
  return { site, title, artist: 'Artist', url, rating, versionLabel }
}

describe('canonicalCandidateUrl', () => {
  it('normalises tracking, fragments and trailing slashes while preserving versions', () => {
    expect(
      canonicalCandidateUrl('https://EXAMPLE.com/song/?utm_source=x&version=2#lyrics')
    ).toBe('https://example.com/song?version=2')
  })
})

describe('selectSearchResults', () => {
  it('takes turns across sources instead of letting ratings crowd them out', () => {
    const results = selectSearchResults(
      [
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/1', 5),
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/2', 4.9),
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/3', 4.8),
        result('pnwchords', 'Good Grace', 'https://pnw.com/1'),
        result('worshiptogether', 'Good Grace', 'https://wt.com/1'),
      ],
      'good grace'
    )

    expect(results.map((item) => item.site)).toEqual([
      'ultimate-guitar',
      'pnwchords',
      'worshiptogether',
      'ultimate-guitar',
      'ultimate-guitar',
    ])
  })

  it('removes duplicate canonical URLs and keeps the best representative', () => {
    const results = selectSearchResults(
      [
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/song?utm_source=a', 3, 'Ver 1'),
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/song/', 4.5, 'Ver 2'),
      ],
      'good grace'
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ rating: 4.5, versionLabel: 'Ver 2' })
  })

  it('keeps distinct versions when capacity allows', () => {
    const results = selectSearchResults(
      [
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/song?version=1', 4, 'Ver 1'),
        result('ultimate-guitar', 'Good Grace', 'https://ug.com/song?version=2', 3, 'Ver 2'),
      ],
      'good grace'
    )
    expect(results).toHaveLength(2)
    expect(results.map((item) => item.versionLabel)).toEqual(['Ver 1', 'Ver 2'])
  })

  it('prefers relevant candidates and falls back when nothing matches', () => {
    const mixed = selectSearchResults(
      [
        result('ultimate-guitar', 'Unrelated Song', 'https://ug.com/unrelated', 5),
        result('pnwchords', 'Good Grace', 'https://pnw.com/good-grace'),
      ],
      'good grace'
    )
    expect(mixed.map((item) => item.title)).toEqual(['Good Grace'])

    const fallback = selectSearchResults(
      [result('ultimate-guitar', 'Unrelated Song', 'https://ug.com/unrelated', 5)],
      'good grace'
    )
    expect(fallback).toHaveLength(1)
  })

  it('fills all capacity from one available source', () => {
    const results = selectSearchResults(
      Array.from({ length: 10 }, (_, index) =>
        result('pnwchords', 'Song', `https://pnw.com/${index}`)
      ),
      'song'
    )
    expect(results).toHaveLength(8)
    expect(results.every((item) => item.site === 'pnwchords')).toBe(true)
  })

  it('is deterministic for the same query and input', () => {
    const input = [
      result('ultimate-guitar', 'Song', 'https://ug.com/b', 4),
      result('ultimate-guitar', 'Song', 'https://ug.com/a', 4),
      result('pnwchords', 'Song', 'https://pnw.com/a'),
    ]
    expect(selectSearchResults(input, 'song')).toEqual(selectSearchResults(input, 'song'))
  })
})
