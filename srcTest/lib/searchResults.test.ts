import { describe, expect, it } from 'vitest'
import {
  allSearchSourcesFailed,
  mergeFinalSearchCandidates,
  mergePartialSearchCandidates,
  sourceLabel,
  upsertSearchSource,
} from '../../src/lib/searchResults'
import type { SearchCandidate } from '../../src/lib/api'

function candidate(
  url: string,
  title = 'Song',
  site = 'pnwchords'
): SearchCandidate {
  return { site, title, artist: 'Artist', url }
}

function sourceCandidates(site: string, count: number): SearchCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`https://${site}.example/song-${index}`, `${site} ${index}`, site)
  )
}

describe('mergePartialSearchCandidates', () => {
  it('reserves capacity so a fast source cannot fill all eight slots', () => {
    const first = mergePartialSearchCandidates([], sourceCandidates('pnwchords', 8))
    expect(first).toHaveLength(2)
    expect(first.every((item) => item.site === 'pnwchords')).toBe(true)

    const second = mergePartialSearchCandidates(first, sourceCandidates('ultimate-guitar', 8))
    expect(second).toHaveLength(4)

    const third = mergePartialSearchCandidates(second, sourceCandidates('worshiptogether', 8))
    expect(third).toHaveLength(6)

    const fourth = mergePartialSearchCandidates(
      third,
      sourceCandidates('worshipchords-net', 8)
    )
    expect(fourth).toHaveLength(8)
    expect(fourth.filter((item) => item.site === 'pnwchords')).toHaveLength(2)
    expect(fourth.filter((item) => item.site === 'ultimate-guitar')).toHaveLength(2)
    expect(fourth.filter((item) => item.site === 'worshiptogether')).toHaveLength(2)
    expect(fourth.filter((item) => item.site === 'worshipchords-net')).toHaveLength(2)
  })

  it('keeps existing positions and refreshes metadata in place', () => {
    const first = candidate('https://pnwchords.com/a?utm_source=x', 'A')
    const second = candidate('https://pnwchords.com/b', 'B')
    const merged = mergePartialSearchCandidates(
      [{ ...first, rating: 3 }],
      [
        { ...candidate('https://pnwchords.com/a/', 'A'), rating: 4.5, versionLabel: 'Ver 2' },
        second,
      ]
    )

    expect(merged.map((item) => item.title)).toEqual(['A', 'B'])
    expect(merged[0]).toMatchObject({ rating: 4.5, versionLabel: 'Ver 2' })
  })

  it('allows one source to fill the list when it is the only source', () => {
    const merged = mergePartialSearchCandidates([], sourceCandidates('pnwchords', 8), 8, 1)
    expect(merged).toHaveLength(8)
  })
})

describe('mergeFinalSearchCandidates', () => {
  it('adopts the backend composition while preserving visible order', () => {
    const previous = [
      candidate('https://pnw.example/a', 'PNW A', 'pnwchords'),
      candidate('https://ug.example/b', 'UG B', 'ultimate-guitar'),
      candidate('https://pnw.example/c', 'PNW C', 'pnwchords'),
    ]
    const final = [
      candidate('https://ug.example/b', 'UG B', 'ultimate-guitar'),
      candidate('https://wt.example/d', 'WT D', 'worshiptogether'),
      candidate('https://pnw.example/a', 'PNW A', 'pnwchords'),
      candidate('https://wt.example/e', 'WT E', 'worshiptogether'),
    ]

    const merged = mergeFinalSearchCandidates(previous, final)
    expect(merged.map((item) => item.title)).toEqual(['PNW A', 'UG B', 'WT D', 'WT E'])
    expect(merged.map((item) => item.site)).toEqual([
      'pnwchords',
      'ultimate-guitar',
      'worshiptogether',
      'worshiptogether',
    ])
  })

  it('drops candidates excluded by the final balanced selection', () => {
    const previous = [
      candidate('https://pnw.example/a', 'PNW A', 'pnwchords'),
      candidate('https://pnw.example/b', 'PNW B', 'pnwchords'),
    ]
    const final = [candidate('https://ug.example/c', 'UG C', 'ultimate-guitar')]
    expect(mergeFinalSearchCandidates(previous, final).map((item) => item.title)).toEqual([
      'UG C',
    ])
  })
})

describe('sourceLabel', () => {
  it('distinguishes the two Worship Chords domains and keeps existing labels', () => {
    expect(sourceLabel('worshipchords')).toBe('Worship Chords (.com)')
    expect(sourceLabel('worshipchords-net')).toBe('Worship Chords (.net)')
    expect(sourceLabel('ultimate-guitar')).toBe('Ultimate Guitar')
    expect(sourceLabel('unknown-site')).toBe('unknown-site')
  })
})

describe('source status helpers', () => {
  it('replaces a source status while preserving source order', () => {
    const sources = [
      { site: 'ultimate-guitar', status: 'failed' as const, count: 0, durationMs: 1 },
      { site: 'pnwchords', status: 'ok' as const, count: 2, durationMs: 1 },
    ]
    expect(
      upsertSearchSource(sources, {
        site: 'ultimate-guitar',
        status: 'ok',
        count: 1,
        durationMs: 2,
      }).map((source) => `${source.site}:${source.status}`)
    ).toEqual(['ultimate-guitar:ok', 'pnwchords:ok'])
  })

  it('detects when every source failed', () => {
    expect(
      allSearchSourcesFailed([
        { site: 'ultimate-guitar', status: 'failed', count: 0, durationMs: 1 },
        { site: 'pnwchords', status: 'failed', count: 0, durationMs: 1 },
      ])
    ).toBe(true)
    expect(
      allSearchSourcesFailed([{ site: 'pnwchords', status: 'empty', count: 0, durationMs: 1 }])
    ).toBe(false)
  })
})
