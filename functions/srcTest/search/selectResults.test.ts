import { describe, expect, it } from 'vitest'
import {
  PARTIAL_SOURCE_RESULT_LIMIT,
  canonicalCandidateUrl,
  selectCombinedSearchResults,
  selectNativeSourceResults,
  selectSearchResults,
} from '../../src/search/selectResults.js'
import { UG_SEARCH_RESULT_LIMIT } from '../../src/search/types.js'
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

  it('caps a single streamed source so other sources still have room', () => {
    const results = selectSearchResults(
      Array.from({ length: 10 }, (_, index) =>
        result('ultimate-guitar', 'Song', `https://ug.com/${index}`, 5 - index / 100)
      ),
      'song',
      PARTIAL_SOURCE_RESULT_LIMIT
    )
    expect(results).toHaveLength(3)
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

describe('combined Ultimate Guitar selection', () => {
  it('takes the first three accessible UG candidates in payload order', () => {
    const input = Array.from({ length: 10 }, (_, index) =>
      result(
        'ultimate-guitar',
        'Song',
        `https://ug.com/song-${index}`,
        5 - index / 10,
        `Ver ${index + 1}`
      )
    )

    const selected = selectNativeSourceResults(input)
    expect(selected).toHaveLength(UG_SEARCH_RESULT_LIMIT)
    expect(selected.map((candidate) => candidate.url)).toEqual([
      'https://ug.com/song-0',
      'https://ug.com/song-1',
      'https://ug.com/song-2',
    ])
  })

  it('deduplicates canonical URLs without reordering', () => {
    const selected = selectNativeSourceResults([
      result('ultimate-guitar', 'Song', 'https://ug.com/a?utm_source=x'),
      result('ultimate-guitar', 'Song', 'https://ug.com/a/'),
      result('ultimate-guitar', 'Song', 'https://ug.com/b'),
    ])
    expect(selected.map((candidate) => candidate.url)).toEqual([
      'https://ug.com/a',
      'https://ug.com/b',
    ])
  })

  it('keeps native UG order ahead of the balanced other sources', () => {
    const candidates = [
      result('ultimate-guitar', 'Song', 'https://ug.com/first', 1),
      result('ultimate-guitar', 'Song', 'https://ug.com/second', 5),
      result('ultimate-guitar', 'Song', 'https://ug.com/third', 2),
      result('ultimate-guitar', 'Song', 'https://ug.com/fourth', 4),
      result('pnwchords', 'Song', 'https://pnw.com/a'),
      result('worshiptogether', 'Song', 'https://wt.com/a'),
    ]

    const selected = selectCombinedSearchResults(candidates, 'song', 8)
    expect(selected.slice(0, 3).map((candidate) => candidate.url)).toEqual([
      'https://ug.com/first',
      'https://ug.com/second',
      'https://ug.com/third',
    ])
    expect(selected.slice(3).map((candidate) => candidate.site)).toEqual([
      'pnwchords',
      'worshiptogether',
    ])
  })

  it('still applies the balanced policy to non-Ultimate-Guitar sources', () => {
    const input = [
      result('pnwchords', 'Song', 'https://pnw.com/b', 1),
      result('pnwchords', 'Song', 'https://pnw.com/a', 5),
      result('worshiptogether', 'Song', 'https://wt.com/a'),
    ]
    expect(selectCombinedSearchResults(input, 'song', 8)).toEqual(
      selectSearchResults(input, 'song', 8)
    )
  })
})
