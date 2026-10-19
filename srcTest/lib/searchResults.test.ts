import { describe, expect, it } from 'vitest'
import {
  allSearchSourcesFailed,
  mergeSearchCandidates,
  upsertSearchSource,
} from '../../src/lib/searchResults'
import type { SearchCandidate } from '../../src/lib/api'

function candidate(url: string, title = 'Song'): SearchCandidate {
  return { site: 'pnwchords', title, artist: 'Artist', url }
}

describe('mergeSearchCandidates', () => {
  it('keeps existing positions and appends new out-of-order source results', () => {
    const first = candidate('https://pnwchords.com/a', 'A')
    const second = candidate('https://pnwchords.com/b', 'B')
    const merged = mergeSearchCandidates([first], [second, first])
    expect(merged.map((item) => item.title)).toEqual(['A', 'B'])
  })

  it('deduplicates canonical URLs and updates metadata in place', () => {
    const merged = mergeSearchCandidates(
      [{ ...candidate('https://pnwchords.com/a?utm_source=x'), rating: 3 }],
      [{ ...candidate('https://pnwchords.com/a/'), rating: 4.5, versionLabel: 'Ver 2' }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ rating: 4.5, versionLabel: 'Ver 2' })
  })

  it('caps the visible list without dropping existing cards', () => {
    const existing = Array.from({ length: 8 }, (_, index) =>
      candidate(`https://pnwchords.com/${index}`)
    )
    const merged = mergeSearchCandidates(existing, [candidate('https://pnwchords.com/new')])
    expect(merged).toHaveLength(8)
    expect(merged.map((item) => item.url)).toEqual(existing.map((item) => item.url))
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
