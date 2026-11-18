import { describe, expect, it } from 'vitest'
import {
  PARTIAL_SOURCE_RESULT_LIMIT,
  canonicalCandidateUrl,
  filterRelevantCandidates,
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
        result('worshipchords-net', 'Good Grace', 'https://wcn.com/1'),
      ],
      'good grace'
    )

    expect(results.map((item) => item.site)).toEqual([
      'ultimate-guitar',
      'pnwchords',
      'worshiptogether',
      'worshipchords-net',
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

  it('drops unrelated candidates instead of falling back when nothing matches', () => {
    const mixed = selectSearchResults(
      [
        result('ultimate-guitar', 'Unrelated Song', 'https://ug.com/unrelated', 5),
        result('pnwchords', 'Good Grace', 'https://pnw.com/good-grace'),
      ],
      'good grace'
    )
    expect(mixed.map((item) => item.title)).toEqual(['Good Grace'])

    const none = selectSearchResults(
      [result('ultimate-guitar', 'Unrelated Song', 'https://ug.com/unrelated', 5)],
      'good grace'
    )
    expect(none).toEqual([])
  })

  it('caps a single streamed source so other sources still have room', () => {
    const results = selectSearchResults(
      Array.from({ length: 10 }, (_, index) =>
        result('ultimate-guitar', 'Song', `https://ug.com/${index}`, 5 - index / 100)
      ),
      'song',
      PARTIAL_SOURCE_RESULT_LIMIT
    )
    expect(PARTIAL_SOURCE_RESULT_LIMIT).toBe(2)
    expect(results).toHaveLength(2)
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
      result('worshipchords-net', 'Song', 'https://wcn.com/a'),
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
      'worshipchords-net',
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

  it('gives every worship source at least 1 slot when all 5 sources return results', () => {
    const candidates = [
      result('ultimate-guitar', 'Song', 'https://ug.com/1'),
      result('ultimate-guitar', 'Song', 'https://ug.com/2'),
      result('ultimate-guitar', 'Song', 'https://ug.com/3'),
      result('pnwchords', 'Song', 'https://pnw.com/1'),
      result('pnwchords', 'Song', 'https://pnw.com/2'),
      result('worshiptogether', 'Song', 'https://wt.com/1'),
      result('worshipchords-net', 'Song', 'https://wcn.com/1'),
      result('worshipchords', 'Song', 'https://wc.com/1'),
    ]

    const selected = selectCombinedSearchResults(candidates, 'song', 8)
    expect(selected).toHaveLength(8)
    const sites = selected.map((c) => c.site)
    expect(sites.filter((s) => s === 'ultimate-guitar')).toHaveLength(3)
    expect(sites).toContain('pnwchords')
    expect(sites).toContain('worshiptogether')
    expect(sites).toContain('worshipchords-net')
    expect(sites).toContain('worshipchords')
  })

  it('filters Ultimate Guitar results by query relevance while preserving UG order', () => {
    const candidates = [
      result('ultimate-guitar', 'Holy Forever', 'https://ug.com/1', 5),
      result('ultimate-guitar', 'You Saved Me', 'https://ug.com/2', 4),
      result('ultimate-guitar', 'You Save Me (Acoustic)', 'https://ug.com/3', 3),
    ]
    const selected = selectCombinedSearchResults(candidates, 'you saved me', 8)
    expect(selected.map((c) => c.title)).toEqual(['You Saved Me', 'You Save Me (Acoustic)'])
  })
})

describe('filterRelevantCandidates', () => {
  it('filters out unrelated Worship Together results for multi-word queries', () => {
    const candidates = [
      result('worshiptogether', 'Fall Like Rain', 'https://wt.com/1'),
      result('worshiptogether', "God I'm Just Grateful", 'https://wt.com/2'),
      result('worshiptogether', 'Holy Forever', 'https://wt.com/3'),
      result('worshiptogether', 'Never Change', 'https://wt.com/4'),
      result('worshiptogether', 'Reasons', 'https://wt.com/5'),
      result('worshiptogether', 'Good Good Father', 'https://wt.com/6'),
      result('worshiptogether', 'How Good Is The Lord', 'https://wt.com/7'),
      result('worshiptogether', 'Giants (How Good Is The Lord)', 'https://wt.com/8'),
    ]

    const filtered = filterRelevantCandidates(candidates, 'Giants how good the lord is')
    expect(filtered.map((c) => c.title)).toEqual([
      'How Good Is The Lord',
      'Giants (How Good Is The Lord)',
    ])
  })

  it('rejects false positives like "You Bless Me" for "You saved me" while allowing close inflections', () => {
    const candidates = [
      result('worshiptogether', 'You Bless Me (Thank You)', 'https://wt.com/1'),
      result('worshiptogether', 'Fall Like Rain', 'https://wt.com/2'),
      result('worshiptogether', 'You Save Me', 'https://wt.com/3'),
      result('pnwchords', 'You Saved Me', 'https://pnw.com/1'),
    ]

    const filtered = filterRelevantCandidates(candidates, 'You saved me')
    expect(filtered.map((c) => c.title)).toEqual(['You Save Me', 'You Saved Me'])
  })

  it('normalizes apostrophes, punctuation, and casing', () => {
    const candidates = [
      result('pnwchords', "The Lord's Prayer", 'https://pnw.com/1'),
      result('pnwchords', 'Lords Prayer (Live)', 'https://pnw.com/2'),
    ]
    expect(filterRelevantCandidates(candidates, "lord's prayer")).toHaveLength(2)
    expect(filterRelevantCandidates(candidates, 'lords prayer')).toHaveLength(2)
  })

  it('ignores stop words unless the entire query consists of stop words', () => {
    const candidates = [result('pnwchords', 'How Great Is Our God', 'https://pnw.com/1')]
    expect(filterRelevantCandidates(candidates, 'how great is the god')).toHaveLength(1)
    expect(filterRelevantCandidates([result('pnwchords', 'The Stand', 'https://pnw.com/2')], 'the')).toHaveLength(1)
  })
})
