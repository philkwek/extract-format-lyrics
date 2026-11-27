import { describe, expect, it } from 'vitest'
import {
  describeClash,
  mergeSet,
  type Clash,
  type MergeResult,
  type SyncedEntry,
  type SyncedSet,
} from '../../src/lib/setMerge'

function song(entryId: string, overrides: Partial<SyncedEntry> = {}): SyncedEntry {
  return {
    entryId,
    url: `https://example.test/${entryId}`,
    title: `Demo Song ${entryId}`,
    artist: 'Demo Artist',
    ...overrides,
  }
}

function makeSet(name: string, songs: SyncedEntry[], createdAt = 1000): SyncedSet {
  return { name, createdAt, songs }
}

function ids(songs: SyncedEntry[]): string[] {
  return songs.map((entry) => entry.entryId)
}

function mergedOf(result: MergeResult): SyncedSet {
  if (!result.ok) throw new Error('expected a merge')
  return result.merged
}

function clashesOf(result: MergeResult): Clash[] {
  if (result.ok) throw new Error('expected a clash')
  return result.clashes
}

type FieldName = Extract<Clash, { kind: 'field' }>['field']

function fieldClash(field: FieldName, title = 'Demo Song A'): Clash {
  return { kind: 'field', entryId: 'A', title, field }
}

const verse = { type: 'Verse' as const, label: 'Verse 1', lines: [] }
const chorus = { type: 'Chorus' as const, label: 'Chorus', lines: [] }

describe('3.3 table: set name', () => {
  it('keeps the local createdAt', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')], 1),
      makeSet('Demo Set', [song('A')], 2),
      makeSet('Demo Set', [song('A')], 3),
    )
    expect(mergedOf(result).createdAt).toBe(2)
  })

  it('takes a name changed on one side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Local Set', [song('A')]),
      makeSet('Demo Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('Local Set')
  })

  it('takes a name changed on the remote side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('Remote Set')
  })

  it('accepts the same new name on both sides', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('New Set', [song('A')]),
      makeSet('New Set', [song('A')]),
    )
    expect(mergedOf(result).name).toBe('New Set')
  })

  it('clashes on different names', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Local Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'name' }])
  })
})

describe('3.3 table: entries added and removed', () => {
  it('keeps an entry added on one side', () => {
    const result = mergeSet(
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', []),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A'])
  })

  it('keeps both entries when each side added a different one', () => {
    const result = mergeSet(
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs).sort()).toEqual(['A', 'B'])
  })

  it('removes an entry removed on one side and unchanged on the other', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B'])
  })

  it('removes an entry removed on both sides', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B'])
  })

  it('clashes when an entry was removed on one side and edited on the other', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B')]),
      makeSet('Demo Set', [song('A', { targetKey: 'A' }), song('B')]),
    )
    expect(clashesOf(result)).toEqual([
      { kind: 'removed-edited', entryId: 'A', title: 'Demo Song A' },
    ])
  })

  it('treats a changed chart as an edit when the other side removed the entry', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', []),
      makeSet('Demo Set', [song('A', { contentHash: 'hash-2' })]),
    )
    expect(clashesOf(result)).toEqual([
      { kind: 'removed-edited', entryId: 'A', title: 'Demo Song A' },
    ])
  })
})

describe('3.3 table: entry fields', () => {
  interface EntryFieldRow {
    name: string
    base: Partial<SyncedEntry>
    local: Partial<SyncedEntry>
    remote: Partial<SyncedEntry>
    expected?: Partial<SyncedEntry>
    clash?: Clash
  }

  const rows: EntryFieldRow[] = [
    {
      name: 'takes a targetKey changed on one side',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'G' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'takes a targetKey changed on the remote side',
      base: { targetKey: 'G' },
      local: { targetKey: 'G' },
      remote: { targetKey: 'A' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'accepts the same targetKey on both sides',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'A' },
      expected: { targetKey: 'A' },
    },
    {
      name: 'clashes on different targetKeys',
      base: { targetKey: 'G' },
      local: { targetKey: 'A' },
      remote: { targetKey: 'B' },
      clash: fieldClash('targetKey'),
    },
    {
      name: 'takes a padKeyMode changed on one side',
      base: { padKeyMode: 'match' },
      local: { padKeyMode: 'custom' },
      remote: { padKeyMode: 'match' },
      expected: { padKeyMode: 'custom' },
    },
    {
      name: 'accepts the same padKeyMode on both sides',
      base: { padKeyMode: 'match' },
      local: { padKeyMode: 'custom' },
      remote: { padKeyMode: 'custom' },
      expected: { padKeyMode: 'custom' },
    },
    {
      name: 'clashes on different padKeyModes',
      base: {},
      local: { padKeyMode: 'match' },
      remote: { padKeyMode: 'custom' },
      clash: fieldClash('padKeyMode'),
    },
    {
      name: 'takes a customPadKey changed on one side',
      base: { customPadKey: 'C' },
      local: { customPadKey: 'D' },
      remote: { customPadKey: 'C' },
      expected: { customPadKey: 'D' },
    },
    {
      name: 'clashes on different customPadKeys',
      base: {},
      local: { customPadKey: 'C' },
      remote: { customPadKey: 'D' },
      clash: fieldClash('customPadKey'),
    },
    {
      name: 'takes a simplified flag changed on one side',
      base: { simplified: false },
      local: { simplified: true },
      remote: { simplified: false },
      expected: { simplified: true },
    },
    {
      name: 'accepts the same simplified flag on both sides',
      base: { simplified: false },
      local: { simplified: true },
      remote: { simplified: true },
      expected: { simplified: true },
    },
    {
      name: 'clashes on different simplified flags',
      base: {},
      local: { simplified: true },
      remote: { simplified: false },
      clash: fieldClash('simplified'),
    },
    {
      name: 'takes a contentHash changed on one side',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-1' },
      expected: { contentHash: 'hash-2' },
    },
    {
      name: 'accepts the same contentHash on both sides',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-2' },
      expected: { contentHash: 'hash-2' },
    },
    {
      name: 'clashes on different contentHashes',
      base: { contentHash: 'hash-1' },
      local: { contentHash: 'hash-2' },
      remote: { contentHash: 'hash-3' },
      clash: fieldClash('song'),
    },
    {
      name: 'takes a title changed on one side as part of the chart',
      base: {},
      local: { title: 'Demo Song A (new)' },
      remote: {},
      expected: { title: 'Demo Song A (new)' },
    },
    {
      name: 'clashes on different titles',
      base: {},
      local: { title: 'Local Title' },
      remote: { title: 'Remote Title' },
      clash: fieldClash('song', 'Local Title'),
    },
    {
      name: 'takes a url changed on one side as part of the chart',
      base: {},
      local: { url: 'https://example.test/other' },
      remote: {},
      expected: { url: 'https://example.test/other' },
    },
    {
      name: 'clashes on different urls',
      base: {},
      local: { url: 'https://example.test/local' },
      remote: { url: 'https://example.test/remote' },
      clash: fieldClash('song'),
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = mergeSet(
        makeSet('Demo Set', [song('A', row.base)]),
        makeSet('Demo Set', [song('A', row.local)]),
        makeSet('Demo Set', [song('A', row.remote)]),
      )
      if (row.clash) {
        expect(clashesOf(result)).toEqual([row.clash])
      } else {
        expect(mergedOf(result).songs).toEqual([song('A', row.expected)])
      }
    })
  }
})

describe('3.3 table: custom sections and flow', () => {
  interface SectionsRow {
    name: string
    base: Partial<SyncedEntry>
    local: Partial<SyncedEntry>
    remote: Partial<SyncedEntry>
    expected?: Partial<SyncedEntry>
    clash?: Clash
  }

  const rows: SectionsRow[] = [
    {
      name: 'takes changed custom sections on one side',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [verse, chorus], customFlow: [0, 1] },
      remote: { customSections: [verse], customFlow: [0] },
      expected: { customSections: [verse, chorus], customFlow: [0, 1] },
    },
    {
      name: 'accepts the same changed custom sections on both sides',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [chorus], customFlow: [0] },
      remote: { customSections: [chorus], customFlow: [0] },
      expected: { customSections: [chorus], customFlow: [0] },
    },
    {
      name: 'clashes on different custom sections',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [chorus], customFlow: [0] },
      remote: { customSections: [verse, chorus], customFlow: [0, 1] },
      clash: { kind: 'sections', entryId: 'A', title: 'Demo Song A', simplified: false },
    },
    {
      name: 'treats custom sections and flow as one unit',
      base: { customSections: [verse], customFlow: [0] },
      local: { customSections: [verse], customFlow: [0, 0] },
      remote: { customSections: [verse], customFlow: [0] },
      expected: { customSections: [verse], customFlow: [0, 0] },
    },
    {
      name: 'takes changed simplified sections on one side',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      expected: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
    },
    {
      name: 'accepts the same changed simplified sections on both sides',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      expected: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
    },
    {
      name: 'clashes on different simplified sections',
      base: { customSimplifiedSections: [verse], customSimplifiedFlow: [0] },
      local: { customSimplifiedSections: [chorus], customSimplifiedFlow: [0] },
      remote: { customSimplifiedSections: [verse, chorus], customSimplifiedFlow: [0, 1] },
      clash: { kind: 'sections', entryId: 'A', title: 'Demo Song A', simplified: true },
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = mergeSet(
        makeSet('Demo Set', [song('A', row.base)]),
        makeSet('Demo Set', [song('A', row.local)]),
        makeSet('Demo Set', [song('A', row.remote)]),
      )
      if (row.clash) {
        expect(clashesOf(result)).toEqual([row.clash])
      } else {
        expect(mergedOf(result).songs).toEqual([song('A', row.expected)])
      }
    })
  }
})

describe('3.3 table: song order', () => {
  const base = makeSet('Demo Set', [song('A'), song('B'), song('C')])

  it('takes the order from the side that reordered', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('C'), song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['C', 'A', 'B'])
  })

  it('takes the order from the remote side when it reordered', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('C'), song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['C', 'A', 'B'])
  })

  it('accepts the same reorder on both sides', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B', 'A', 'C'])
  })

  it('clashes when both sides reorder differently', () => {
    const result = mergeSet(
      base,
      makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      makeSet('Demo Set', [song('C'), song('B'), song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'order' }])
  })

  it('places additions after the entry they follow on their side', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('A'), song('X'), song('B'), song('C')]),
      makeSet('Demo Set', [song('A'), song('B'), song('Y'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A', 'X', 'B', 'Y', 'C'])
  })

  it('places a leading addition first', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('X'), song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['X', 'A', 'B'])
  })

  it('keeps a reordered addition with the side that reordered', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      makeSet('Demo Set', [song('B'), song('X'), song('A'), song('C')]),
      makeSet('Demo Set', [song('A'), song('B'), song('C')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['B', 'X', 'A', 'C'])
  })
})

describe('empty base (first sign-in, 3.6)', () => {
  it('merges identical sets and keeps the local createdAt', () => {
    const merged = mergedOf(
      mergeSet(null, makeSet('Demo Set', [song('A')], 100), makeSet('Demo Set', [song('A')], 200)),
    )
    expect(merged).toEqual(makeSet('Demo Set', [song('A')], 100))
  })

  it('keeps entries that exist on only one side', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A')]),
      makeSet('Demo Set', [song('B')]),
    )
    expect(ids(mergedOf(result).songs).sort()).toEqual(['A', 'B'])
  })

  it('clashes on different names', () => {
    const result = mergeSet(
      null,
      makeSet('Local Set', [song('A')]),
      makeSet('Remote Set', [song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'name' }])
  })

  it('clashes on a field with different values on each side', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A', { targetKey: 'G' })]),
      makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
    )
    expect(clashesOf(result)).toEqual([fieldClash('targetKey')])
  })

  it('clashes on different sections', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })]),
      makeSet('Demo Set', [song('A', { customSections: [chorus], customFlow: [0] })]),
    )
    expect(clashesOf(result)).toEqual([
      { kind: 'sections', entryId: 'A', title: 'Demo Song A', simplified: false },
    ])
  })

  it('clashes when the order of common entries differs', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('B'), song('A')]),
    )
    expect(clashesOf(result)).toEqual([{ kind: 'order' }])
  })

  it('accepts the same order of common entries', () => {
    const result = mergeSet(
      null,
      makeSet('Demo Set', [song('A'), song('B')]),
      makeSet('Demo Set', [song('A'), song('B')]),
    )
    expect(ids(mergedOf(result).songs)).toEqual(['A', 'B'])
  })
})

describe('inputs', () => {
  it('does not mutate its inputs on a clean merge', () => {
    const base = makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })])
    const local = makeSet('Demo Set', [
      song('A', { targetKey: 'A', customSections: [chorus], customFlow: [0] }),
    ])
    const remote = makeSet('Demo Set', [song('A'), song('B')])
    const before = [structuredClone(base), structuredClone(local), structuredClone(remote)]

    mergeSet(base, local, remote)

    expect([base, local, remote]).toEqual(before)
  })

  it('does not mutate its inputs on a clash', () => {
    const base = makeSet('Demo Set', [song('A'), song('B')])
    const local = makeSet('Local Set', [song('A', { targetKey: 'A' }), song('B')])
    const remote = makeSet('Remote Set', [song('A', { targetKey: 'B' }), song('B')])
    const before = [structuredClone(base), structuredClone(local), structuredClone(remote)]

    mergeSet(base, local, remote)

    expect([base, local, remote]).toEqual(before)
  })
})

describe('nothing lost', () => {
  interface NothingLostCase {
    name: string
    base: SyncedSet | null
    local: SyncedSet
    remote: SyncedSet
  }

  const cases: NothingLostCase[] = [
    {
      name: 'name',
      base: makeSet('Demo Set', [song('A')]),
      local: makeSet('Local Set', [song('A')]),
      remote: makeSet('Remote Set', [song('A')]),
    },
    {
      name: 'field',
      base: makeSet('Demo Set', [song('A')]),
      local: makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'B' })]),
    },
    {
      name: 'sections',
      base: makeSet('Demo Set', [song('A', { customSections: [verse], customFlow: [0] })]),
      local: makeSet('Demo Set', [song('A', { customSections: [chorus], customFlow: [0] })]),
      remote: makeSet('Demo Set', [
        song('A', { customSections: [verse, chorus], customFlow: [0, 1] }),
      ]),
    },
    {
      name: 'removed-edited',
      base: makeSet('Demo Set', [song('A'), song('B')]),
      local: makeSet('Demo Set', [song('B')]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'A' }), song('B')]),
    },
    {
      name: 'order',
      base: makeSet('Demo Set', [song('A'), song('B'), song('C')]),
      local: makeSet('Demo Set', [song('B'), song('A'), song('C')]),
      remote: makeSet('Demo Set', [song('C'), song('B'), song('A')]),
    },
    {
      name: 'empty base field',
      base: null,
      local: makeSet('Demo Set', [song('A', { targetKey: 'A' })]),
      remote: makeSet('Demo Set', [song('A', { targetKey: 'B' })]),
    },
  ]

  for (const item of cases) {
    it(`returns the exact local and remote sets on a ${item.name} clash`, () => {
      const localBefore = structuredClone(item.local)
      const remoteBefore = structuredClone(item.remote)

      const result = mergeSet(item.base, item.local, item.remote)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.local).toBe(item.local)
      expect(result.remote).toBe(item.remote)
      expect(result.local).toEqual(localBefore)
      expect(result.remote).toEqual(remoteBefore)
      expect(result.clashes.length).toBeGreaterThan(0)
    })
  }
})

describe('describeClash', () => {
  it('describes a name clash', () => {
    expect(describeClash({ kind: 'name' })).toBe('Both devices renamed this set.')
  })

  it('describes a key clash', () => {
    expect(describeClash(fieldClash('targetKey'))).toBe(
      'Both devices changed the key of Demo Song A.',
    )
  })

  it('describes a pad clash', () => {
    expect(describeClash(fieldClash('padKeyMode'))).toBe(
      'Both devices changed the pad for Demo Song A.',
    )
    expect(describeClash(fieldClash('customPadKey'))).toBe(
      'Both devices changed the pad for Demo Song A.',
    )
  })

  it('describes a simplified-chords clash', () => {
    expect(describeClash(fieldClash('simplified'))).toBe(
      'Both devices changed simplified chords for Demo Song A.',
    )
  })

  it('describes a chart clash', () => {
    expect(describeClash(fieldClash('song'))).toBe(
      'Both devices updated the chart for Demo Song A.',
    )
  })

  it('describes a sections clash', () => {
    expect(
      describeClash({
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: false,
      }),
    ).toBe('Both devices edited the sections of Demo Song A.')
    expect(
      describeClash({
        kind: 'sections',
        entryId: 'A',
        title: 'Demo Song A',
        simplified: true,
      }),
    ).toBe('Both devices edited the sections of Demo Song A (simplified).')
  })

  it('describes a removed-edited clash', () => {
    expect(describeClash({ kind: 'removed-edited', entryId: 'A', title: 'Demo Song A' })).toBe(
      'Demo Song A was removed on one device and changed on the other.',
    )
  })

  it('describes an order clash', () => {
    expect(describeClash({ kind: 'order' })).toBe('Both devices changed the song order.')
  })

  it('falls back to "a song" when the entry has no title', () => {
    const result = mergeSet(
      makeSet('Demo Set', [song('A', { title: undefined })]),
      makeSet('Demo Set', [song('A', { title: undefined, targetKey: 'A' })]),
      makeSet('Demo Set', [song('A', { title: undefined, targetKey: 'B' })]),
    )
    expect(clashesOf(result)).toEqual([fieldClash('targetKey', 'a song')])
    expect(describeClash(clashesOf(result)[0])).toBe('Both devices changed the key of a song.')
  })
})
